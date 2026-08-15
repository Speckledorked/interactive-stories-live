import { describe, it, expect, vi, beforeEach } from 'vitest'

// #293: retrieveRelevantHistory's own fail-open behavior (its try/catch
// around the $queryRaw call and the embedding call ahead of it) had no
// test coverage anywhere — only its pure post-filter (filterAndRankMemories,
// below) was tested. A broken query or a down embedding provider must
// degrade to "no memories this turn," never take down scene resolution.
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    worldMeta: { findUnique: vi.fn() },
  },
}))
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
