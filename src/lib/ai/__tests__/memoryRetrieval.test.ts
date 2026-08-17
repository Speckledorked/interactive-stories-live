import { describe, it, expect, vi, beforeEach } from 'vitest'

// #293: retrieveRelevantHistory's own fail-open behavior (its try/catch
// around the $queryRaw call and the embedding call ahead of it) had no
// test coverage anywhere — only its pure post-filter (filterAndRankMemories,
// below) was tested. A broken query or a down embedding provider must
// degrade to "no memories this turn," never take down scene resolution.
// #445: the semantic search now runs inside an interactive $transaction,
// because SET LOCAL only means anything inside a transaction block — see
// memoryRetrieval.ts. The mock hands the callback a tx that delegates to the
// same spies, so every existing assertion about $queryRaw/$executeRawUnsafe
// keeps working AND a test can assert the two really do share one
// transaction.
vi.mock('@/lib/prisma', () => {
  const prisma: any = {
    $queryRaw: vi.fn(),
    // #391: SET LOCAL hnsw.ef_search, so the candidate pool the CTE asks
    // for is the pool pgvector actually returns.
    $executeRawUnsafe: vi.fn(),
    $executeRaw: vi.fn(),
    worldMeta: { findUnique: vi.fn() },
  }
  prisma.$transaction = vi.fn(async (fn: any) =>
    typeof fn === 'function'
      ? fn({
          $queryRaw: (...args: any[]) => prisma.$queryRaw(...args),
          $executeRawUnsafe: (...args: any[]) => prisma.$executeRawUnsafe(...args),
        })
      : Promise.all(fn)
  )
  return { prisma }
})
vi.mock('../embeddingService', () => ({
  embedWithCostTracking: vi.fn(),
}))

import { filterAndRankMemories, retrieveRelevantHistory } from '../memoryRetrieval'
import { generateEntityPairs, MAX_ENTITY_PAIRS } from '../crossEntityRecall'
import type { RetrievedMemory, RetrievalContext } from '../memoryRetrieval'
import { prisma } from '@/lib/prisma'
import { embedWithCostTracking } from '../embeddingService'

function makeContext(overrides: Partial<RetrievalContext> = {}): RetrievalContext {
  return {
    currentScene: { sceneIntroText: 'A quiet tavern.', stakes: null, location: null } as any,
    playerActions: [],
    characters: [],
    npcs: [],
    factions: [],
    ...overrides,
  }
}

function makeMemory(overrides: Partial<RetrievedMemory> = {}): RetrievedMemory {
  return {
    id: 'mem-1',
    turnNumber: 1,
    title: 'A thing happened',
    summary: 'Something happened.',
    memoryType: 'SCENE',
    importance: 'NORMAL',
    emotionalTone: null,
    similarity: 0.8,
    ...overrides,
  }
}

describe('filterAndRankMemories', () => {
  it('drops memories below the similarity threshold', () => {
    const memories = [makeMemory({ id: 'a', similarity: 0.9 }), makeMemory({ id: 'b', similarity: 0.5 })]
    const result = filterAndRankMemories(memories, { minSimilarity: 0.7, importanceBoost: false, maxMemories: 10 })
    expect(result.map((m) => m.id)).toEqual(['a'])
  })

  it('caps results at maxMemories', () => {
    const memories = Array.from({ length: 5 }, (_, i) => makeMemory({ id: `m${i}`, similarity: 0.9 }))
    const result = filterAndRankMemories(memories, { minSimilarity: 0.7, importanceBoost: false, maxMemories: 2 })
    expect(result).toHaveLength(2)
  })

  it('leaves order untouched when importanceBoost is off', () => {
    const memories = [
      makeMemory({ id: 'critical-but-lower-sim', similarity: 0.71, importance: 'CRITICAL' }),
      makeMemory({ id: 'normal-higher-sim', similarity: 0.9, importance: 'NORMAL' }),
    ]
    const result = filterAndRankMemories(memories, { minSimilarity: 0.7, importanceBoost: false, maxMemories: 10 })
    expect(result.map((m) => m.id)).toEqual(['critical-but-lower-sim', 'normal-higher-sim'])
  })

  it('boosts a CRITICAL memory above a NORMAL one with slightly higher raw similarity', () => {
    // 0.71 * 1.3 = 0.923 > 0.9 * 1.0 = 0.9 — CRITICAL should win despite lower similarity
    const memories = [
      makeMemory({ id: 'normal-higher-sim', similarity: 0.9, importance: 'NORMAL' }),
      makeMemory({ id: 'critical-lower-sim', similarity: 0.71, importance: 'CRITICAL' }),
    ]
    const result = filterAndRankMemories(memories, { minSimilarity: 0.7, importanceBoost: true, maxMemories: 10 })
    expect(result[0].id).toBe('critical-lower-sim')
  })

  it('does not let a large similarity gap be overcome by importance alone', () => {
    // 0.75 * 1.3 = 0.975 < 0.95 * 1.0 = 0.95 is false actually — pick numbers where NORMAL still wins:
    // 0.95 * 1.0 = 0.95 > 0.72 * 1.3 = 0.936
    const memories = [
      makeMemory({ id: 'normal-much-higher-sim', similarity: 0.95, importance: 'NORMAL' }),
      makeMemory({ id: 'critical-much-lower-sim', similarity: 0.72, importance: 'CRITICAL' }),
    ]
    const result = filterAndRankMemories(memories, { minSimilarity: 0.7, importanceBoost: true, maxMemories: 10 })
    expect(result[0].id).toBe('normal-much-higher-sim')
  })

  it('treats an unrecognized importance value as an unboosted 1.0 weight', () => {
    const memories = [makeMemory({ id: 'unknown', similarity: 0.8, importance: 'SOMETHING_NEW' })]
    const result = filterAndRankMemories(memories, { minSimilarity: 0.7, importanceBoost: true, maxMemories: 10 })
    expect(result).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// retrieveRelevantHistory — fail-open behavior (#293)
// ---------------------------------------------------------------------------
// This function feeds directly into scene resolution's prompt-building
// step — a thrown error here must degrade to "no memories this turn,"
// never propagate and take down an otherwise-successful scene resolution.
// The real pgvector query/blend itself is covered against live Postgres
// in memoryRetrieval.liveDb.test.ts; this is the control-flow half only.

describe('retrieveRelevantHistory — fail-open behavior (#293)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(embedWithCostTracking).mockResolvedValue('[0.1,0.2,0.3]')
    vi.mocked(prisma.$queryRaw).mockResolvedValue([])
  })

  it('returns an empty array, not a throw, when the $queryRaw call itself fails', async () => {
    vi.mocked(prisma.$queryRaw).mockRejectedValue(new Error('connection reset'))

    const result = await retrieveRelevantHistory('camp1', makeContext(), {})

    expect(result).toEqual([])
  })

  it('returns an empty array, not a throw, when the embedding call itself fails', async () => {
    vi.mocked(embedWithCostTracking).mockRejectedValue(new Error('OpenAI outage'))

    const result = await retrieveRelevantHistory('camp1', makeContext(), {})

    expect(result).toEqual([])
    // Never even reaches the query it has no embedding to run.
    expect(prisma.$queryRaw).not.toHaveBeenCalled()
  })

  it('short-circuits to an empty array without querying when the built search context is empty', async () => {
    const emptyContext = makeContext({ currentScene: { sceneIntroText: null, stakes: null, location: null } as any })

    const result = await retrieveRelevantHistory('camp1', emptyContext, {})

    expect(result).toEqual([])
    expect(embedWithCostTracking).not.toHaveBeenCalled()
    expect(prisma.$queryRaw).not.toHaveBeenCalled()
  })

  it('still returns real results on the happy path once embedding and query both succeed', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      { id: 'mem-1', turnNumber: 1, title: 'A thing happened', summary: 's', memoryType: 'SCENE', importance: 'NORMAL', emotionalTone: null, similarity: 0.95 },
    ] as any)

    const result = await retrieveRelevantHistory('camp1', makeContext(), { minSimilarity: 0.5 })

    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('A thing happened')
  })
})

// ---------------------------------------------------------------------------
// hnsw.ef_search (#391, fixed properly in #445)
// ---------------------------------------------------------------------------
// #391 diagnosed this exactly right — pgvector's HNSW search returns fewer
// rows than LIMIT when LIMIT exceeds hnsw.ef_search (default 40), so the
// "generous candidate window" the CTE justifies at length was silently ~40
// rows before the entity and fog filters cut it further.
//
// And then it issued `SET LOCAL` outside any transaction, where Postgres
// warns and IGNORES it, with a comment asserting the opposite ("SET LOCAL
// scopes this to the surrounding transaction"). There was no surrounding
// transaction. The setting never applied, the pool stayed at 40, and nothing
// tested either half — the fix and the bug had identical observable
// behaviour, which is why it survived a release.

describe('the candidate-pool setting actually applies (#445)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(embedWithCostTracking).mockResolvedValue({ embedding: [0.1, 0.2, 0.3] } as any)
    vi.mocked(prisma.$queryRaw).mockResolvedValue([] as any)
  })

  it('runs the search inside a transaction', async () => {
    await retrieveRelevantHistory('camp1', makeContext(), {})
    expect(prisma.$transaction).toHaveBeenCalled()
  })

  it('issues SET LOCAL from INSIDE that transaction, not beside it', async () => {
    // The whole finding in one assertion. Outside a transaction block
    // Postgres discards the statement, so "was it called" is not the
    // question — "was it called somewhere it counts" is.
    let insideTransaction = false
    let setLocalWasInside = false
    ;(prisma.$executeRawUnsafe as any).mockImplementation(async (sql: string) => {
      if (/SET LOCAL/i.test(sql)) setLocalWasInside = insideTransaction
      return 0
    })
    ;(prisma.$transaction as any).mockImplementation(async (fn: any) => {
      insideTransaction = true
      try {
        return await fn({
          $queryRaw: (...args: any[]) => (prisma.$queryRaw as any)(...args),
          $executeRawUnsafe: (...args: any[]) => (prisma.$executeRawUnsafe as any)(...args),
        })
      } finally {
        insideTransaction = false
      }
    })

    await retrieveRelevantHistory('camp1', makeContext(), {})

    expect(setLocalWasInside).toBe(true)
  })

  it('sets ef_search to at least the pool the query then asks for', async () => {
    // The two numbers are derived from one expression, so what matters is
    // that the setting is never SMALLER than the LIMIT — which is the
    // condition under which HNSW silently returns short.
    await retrieveRelevantHistory('camp1', makeContext(), { maxMemories: 25 })

    const sql = vi.mocked(prisma.$executeRawUnsafe).mock.calls
      .map((c) => String(c[0]))
      .find((c) => /SET LOCAL hnsw\.ef_search/i.test(c))
    expect(sql).toBeDefined()
    const value = Number(/=\s*(\d+)/.exec(sql!)![1])
    expect(value).toBeGreaterThanOrEqual(25 * 2)
  })

  it('never sets it below the floor, even for a tiny request', async () => {
    await retrieveRelevantHistory('camp1', makeContext(), { maxMemories: 1 })

    const sql = String(vi.mocked(prisma.$executeRawUnsafe).mock.calls[0]?.[0] ?? '')
    const value = Number(/=\s*(\d+)/.exec(sql)?.[1] ?? 0)
    expect(value).toBeGreaterThan(40) // pgvector's own default, the value this exists to raise
  })
})

// ---------------------------------------------------------------------------
// Cross-entity pair cap (#80)
// ---------------------------------------------------------------------------
// The entity list feeding this comes from substring-matching PLAYER-WRITTEN
// action text against known entity names, and pairing is combinatorial —
// so without a cap a player can inflate one scene resolution into dozens of
// parallel vector queries purely by name-dropping.

describe('generateEntityPairs — amplification cap (#80)', () => {
  it('produces all pairs when comfortably under the cap', () => {
    expect(generateEntityPairs(['a', 'b', 'c'])).toEqual([
      ['a', 'b'],
      ['a', 'c'],
      ['b', 'c'],
    ])
  })

  it('caps the pair count no matter how many entities are mentioned', () => {
    const many = Array.from({ length: 30 }, (_, i) => `e${i}`) // 435 uncapped pairs
    expect(generateEntityPairs(many)).toHaveLength(MAX_ENTITY_PAIRS)
  })

  it('degrades toward the earliest-listed (most relevant) entities', () => {
    const many = Array.from({ length: 30 }, (_, i) => `e${i}`)
    const pairs = generateEntityPairs(many, 3)
    // All retained pairs are among the first few entities, not an arbitrary
    // slice that happens to pin e0 against distant name-drops.
    expect(pairs).toEqual([
      ['e0', 'e1'],
      ['e0', 'e2'],
      ['e1', 'e2'],
    ])
  })

  it('still dedupes before pairing', () => {
    expect(generateEntityPairs(['a', 'a', 'b'])).toEqual([['a', 'b']])
  })

  it('returns nothing for zero or one entity', () => {
    expect(generateEntityPairs([])).toEqual([])
    expect(generateEntityPairs(['solo'])).toEqual([])
  })

  it('honors an explicit cap override', () => {
    expect(generateEntityPairs(['a', 'b', 'c', 'd'], 2)).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// #390: unscored memories must not win the ranking
// ---------------------------------------------------------------------------
//
// crossEntityRecall is a structural intersection ordered by recency — no
// query embedding, so nothing to score. It used to report a hardcoded 1.0,
// which both bypassed the minSimilarity floor and carried the maximum
// possible base score into the importance-boosted re-sort, so those rows
// beat memories that were genuinely similar to the scene at hand.

describe('filterAndRankMemories — unscored memories (#390)', () => {
  const memory = (over: Partial<RetrievedMemory>): RetrievedMemory => ({
    id: 'm', turnNumber: 1, title: 't', summary: 's', memoryType: 'SCENE',
    importance: 'NORMAL', emotionalTone: null, similarity: 0.9, ...over,
  })

  it('exempts an unscored memory from the similarity floor', () => {
    // It earned its place structurally, by involving both queried
    // entities — not by resembling the query.
    const result = filterAndRankMemories(
      [memory({ id: 'unscored', similarity: null })],
      { minSimilarity: 0.7, importanceBoost: false, maxMemories: 5 }
    )

    expect(result.map((m) => m.id)).toEqual(['unscored'])
  })

  it('ranks an unscored memory after every scored one', () => {
    const result = filterAndRankMemories(
      [
        memory({ id: 'unscored', similarity: null }),
        memory({ id: 'weakly-scored', similarity: 0.71 }),
      ],
      { minSimilarity: 0.7, importanceBoost: true, maxMemories: 5 }
    )

    expect(result.map((m) => m.id)).toEqual(['weakly-scored', 'unscored'])
  })

  it('does not let importance weighting float an unscored memory to the top', () => {
    const result = filterAndRankMemories(
      [
        memory({ id: 'unscored-critical', similarity: null, importance: 'CRITICAL' }),
        memory({ id: 'scored-minor', similarity: 0.75, importance: 'MINOR' }),
      ],
      { minSimilarity: 0.7, importanceBoost: true, maxMemories: 5 }
    )

    expect(result[0].id).toBe('scored-minor')
  })

  it('still drops a scored memory below the floor', () => {
    const result = filterAndRankMemories(
      [memory({ id: 'too-distant', similarity: 0.4 })],
      { minSimilarity: 0.7, importanceBoost: false, maxMemories: 5 }
    )

    expect(result).toEqual([])
  })
})
