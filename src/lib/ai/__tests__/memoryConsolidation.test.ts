import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
  },
}))

vi.mock('../memoryCreation', () => ({
  // #216: createCampaignMemory now returns whether the write succeeded,
  // so consolidateOldMemories can skip deleting the source memories when
  // it didn't. Defaults to true (the common case) so every existing test
  // below that doesn't care about the failure path keeps behaving as it
  // did before this return value existed.
  createCampaignMemory: vi.fn().mockResolvedValue('era-1'),
}))

import { prisma } from '@/lib/prisma'
import { createCampaignMemory } from '../memoryCreation'
import { simTurn } from '@/lib/game/turnClock'
import {
  decideConsolidationBuckets,
  consolidateOldMemories,
  isFrequentlyRetrieved,
  ERA_SUMMARY_TAG,
  type EligibleMemoryRow,
} from '../memoryConsolidation'

function makeRow(overrides: Partial<EligibleMemoryRow> = {}): EligibleMemoryRow {
  return {
    id: `row-${Math.random()}`,
    turnNumber: 1,
    title: 'Something minor happened',
    summary: 'A brief thing.',
    involvedCharacterIds: [],
    involvedNpcIds: [],
    involvedFactionIds: [],
    locationTags: [],
    retrievalCount: 0,
    lastRetrievedTurn: null,
    ...overrides,
  }
}

describe('decideConsolidationBuckets (pure)', () => {
  it('groups memories into fixed 10-turn windows', () => {
    const rows = [
      makeRow({ id: 'a', turnNumber: 1 }),
      makeRow({ id: 'b', turnNumber: 5 }),
      makeRow({ id: 'c', turnNumber: 9 }),
    ]
    const buckets = decideConsolidationBuckets(rows)
    expect(buckets).toHaveLength(1)
    expect(buckets[0]).toMatchObject({ startTurn: 1, endTurn: 10, maxTurn: 9 })
    expect(buckets[0].memories.map((m) => m.id).sort()).toEqual(['a', 'b', 'c'])
  })

  it('splits memories that straddle a window boundary into separate buckets', () => {
    const rows = [
      makeRow({ id: 'a', turnNumber: 9 }),
      makeRow({ id: 'b', turnNumber: 10 }),
      makeRow({ id: 'c', turnNumber: 11 }),
    ]
    const buckets = decideConsolidationBuckets(rows)
    // turns 9-10 fall in window 1-10, turn 11 falls in window 11-20 — only
    // the first window has enough (2 < MIN_BUCKET_SIZE_TO_CONSOLIDATE=3) so
    // actually neither should qualify on its own here.
    expect(buckets).toHaveLength(0)
  })

  it('drops a window with fewer than the minimum bucket size', () => {
    const rows = [makeRow({ id: 'a', turnNumber: 1 }), makeRow({ id: 'b', turnNumber: 2 })]
    const buckets = decideConsolidationBuckets(rows)
    expect(buckets).toHaveLength(0)
  })

  it('produces one bucket per distinct window when both meet the minimum', () => {
    const rows = [
      makeRow({ id: 'a', turnNumber: 1 }),
      makeRow({ id: 'b', turnNumber: 2 }),
      makeRow({ id: 'c', turnNumber: 3 }),
      makeRow({ id: 'd', turnNumber: 11 }),
      makeRow({ id: 'e', turnNumber: 12 }),
      makeRow({ id: 'f', turnNumber: 13 }),
    ]
    const buckets = decideConsolidationBuckets(rows)
    expect(buckets).toHaveLength(2)
    expect(buckets.map((b) => b.startTurn).sort((x, y) => x - y)).toEqual([1, 11])
  })

  it('returns an empty array for no eligible memories', () => {
    expect(decideConsolidationBuckets([])).toEqual([])
  })

  // #216: bucketSize is now a parameter (defaulting to the 10-turn MINOR
  // width) so the MAJOR tier can group into much wider windows — rarer
  // events need a wider window to ever reach MIN_BUCKET_SIZE_TO_CONSOLIDATE.
  it('groups into a wider window when a larger bucketSize is passed', () => {
    const rows = [
      makeRow({ id: 'a', turnNumber: 1 }),
      makeRow({ id: 'b', turnNumber: 25 }),
      makeRow({ id: 'c', turnNumber: 49 }),
    ]
    // Default 10-turn width would split these into 3 separate (too-small)
    // windows; a 50-turn width groups all 3 into one.
    expect(decideConsolidationBuckets(rows)).toHaveLength(0)
    const wide = decideConsolidationBuckets(rows, 50)
    expect(wide).toHaveLength(1)
    expect(wide[0]).toMatchObject({ startTurn: 1, endTurn: 50, maxTurn: 49 })
  })
})

describe('isFrequentlyRetrieved (pure)', () => {
  it('exempts a memory retrieved often and recently', () => {
    expect(isFrequentlyRetrieved({ retrievalCount: 3, lastRetrievedTurn: 90 }, simTurn(100))).toBe(true)
  })

  it('does not exempt a memory retrieved fewer than the minimum count', () => {
    expect(isFrequentlyRetrieved({ retrievalCount: 2, lastRetrievedTurn: 90 }, simTurn(100))).toBe(false)
  })

  it('does not exempt a memory retrieved often but not recently', () => {
    // retrieved 10 times, but not for the last 30 turns — was useful once, not still useful now
    expect(isFrequentlyRetrieved({ retrievalCount: 10, lastRetrievedTurn: 70 }, simTurn(100))).toBe(false)
  })

  it('does not exempt a memory that has never been retrieved', () => {
    expect(isFrequentlyRetrieved({ retrievalCount: 0, lastRetrievedTurn: null }, simTurn(100))).toBe(false)
  })

  it('is inclusive at exactly the recency boundary', () => {
    expect(isFrequentlyRetrieved({ retrievalCount: 3, lastRetrievedTurn: 85 }, simTurn(100))).toBe(true) // 100-85=15
    expect(isFrequentlyRetrieved({ retrievalCount: 3, lastRetrievedTurn: 84 }, simTurn(100))).toBe(false) // 100-84=16
  })
})

describe('consolidateOldMemories (DB wrapper)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('no-ops when currentTurn is within the age threshold', async () => {
    const result = await consolidateOldMemories('campaign-1', simTurn(5)) // cutoff would be negative
    expect(result).toEqual({ bucketsConsolidated: 0, memoriesRemoved: 0 })
    expect(prisma.$queryRaw).not.toHaveBeenCalled()
  })

  it('no-ops when the query finds no eligible memories', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([])
    const result = await consolidateOldMemories('campaign-1', simTurn(25))
    expect(result).toEqual({ bucketsConsolidated: 0, memoriesRemoved: 0 })
    expect(createCampaignMemory).not.toHaveBeenCalled()
    expect(prisma.$executeRaw).not.toHaveBeenCalled()
  })

  it('no-ops when the only eligible window is below the minimum bucket size', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([makeRow({ turnNumber: 1 }), makeRow({ turnNumber: 2 })])
    const result = await consolidateOldMemories('campaign-1', simTurn(25))
    expect(result).toEqual({ bucketsConsolidated: 0, memoriesRemoved: 0 })
    expect(createCampaignMemory).not.toHaveBeenCalled()
  })

  it('creates one consolidated memory and deletes the originals for a full bucket', async () => {
    const rows = [
      makeRow({ id: 'a', turnNumber: 1, title: 'Weather shifted', involvedFactionIds: ['f1'] }),
      makeRow({ id: 'b', turnNumber: 4, title: 'Minor rumor', involvedNpcIds: ['n1'] }),
      makeRow({ id: 'c', turnNumber: 8, title: 'Small trade', involvedFactionIds: ['f1', 'f2'] }),
    ]
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce(rows)

    const result = await consolidateOldMemories('campaign-1', simTurn(25))

    expect(result).toEqual({ bucketsConsolidated: 1, memoriesRemoved: 3 })
    expect(createCampaignMemory).toHaveBeenCalledTimes(1)

    const call = vi.mocked(createCampaignMemory).mock.calls[0][0]
    expect(call.campaignId).toBe('campaign-1')
    expect(call.tags).toEqual([ERA_SUMMARY_TAG])
    expect(call.importance).toBe('NORMAL')
    expect(call.turnNumber).toBe(8) // max turn in the bucket
    expect(call.involvedFactionIds.sort()).toEqual(['f1', 'f2'])
    expect(call.involvedNpcIds).toEqual(['n1'])

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1)
  })

  it('never queries memories newer than currentTurn minus the age threshold', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([])
    await consolidateOldMemories('campaign-1', simTurn(30))
    // Just confirm it actually ran the query this time (currentTurn - 20 = 10 > 0)
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1)
  })

  it('does not throw when the underlying query rejects', async () => {
    vi.mocked(prisma.$queryRaw).mockRejectedValueOnce(new Error('db down'))
    const result = await consolidateOldMemories('campaign-1', simTurn(25))
    expect(result).toEqual({ bucketsConsolidated: 0, memoriesRemoved: 0 })
  })

  it('exempts a frequently-and-recently-retrieved memory from an otherwise-full bucket', async () => {
    const rows = [
      makeRow({ id: 'a', turnNumber: 1, retrievalCount: 5, lastRetrievedTurn: 24 }), // frequent, exempt
      makeRow({ id: 'b', turnNumber: 4 }),
      makeRow({ id: 'c', turnNumber: 8 }),
    ]
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce(rows)

    // Bucket now only has 'b' and 'c' — below MIN_BUCKET_SIZE_TO_CONSOLIDATE (3)
    const result = await consolidateOldMemories('campaign-1', simTurn(25))

    expect(result).toEqual({ bucketsConsolidated: 0, memoriesRemoved: 0 })
    expect(createCampaignMemory).not.toHaveBeenCalled()
  })

  it('still consolidates a bucket once the frequently-retrieved memory is excluded, keeping only the rest', async () => {
    const rows = [
      makeRow({ id: 'a', turnNumber: 1, retrievalCount: 5, lastRetrievedTurn: 24 }), // frequent, exempt
      makeRow({ id: 'b', turnNumber: 3 }),
      makeRow({ id: 'c', turnNumber: 6 }),
      makeRow({ id: 'd', turnNumber: 9 }),
    ]
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce(rows)

    const result = await consolidateOldMemories('campaign-1', simTurn(25))

    expect(result).toEqual({ bucketsConsolidated: 1, memoriesRemoved: 3 })
    // The exempt memory 'a' must never appear among the archived ids.
    // #392: the interpolated args shifted by one when this became an
    // UPDATE ... SET consolidatedIntoId = $1 WHERE id = ANY($2).
    // args[0] is the template-strings array; the interpolated values
    // follow it, so skip it and take the first real string[] argument.
    const [, ...archiveArgs] = vi.mocked(prisma.$executeRaw).mock.calls[0] as unknown[]
    const archivedIds = archiveArgs.find(
      (a): a is string[] => Array.isArray(a) && a.every((x) => typeof x === 'string')
    )!
    expect([...archivedIds].sort()).toEqual(['b', 'c', 'd'])
  })

  // #216: MAJOR/CRITICAL memories used to be permanently exempt from
  // consolidation, growing unbounded on a long campaign. These tests cover
  // the second tier this fix adds — a much longer horizon (150 turns) and
  // wider bucket (50 turns), run alongside (not instead of) the existing
  // MINOR/NORMAL tier.
  describe('MAJOR/CRITICAL tier (#216)', () => {
    it('does not touch MAJOR/CRITICAL memories until well past the MINOR tier\'s horizon', async () => {
      // currentTurn=25 is well past the MINOR tier's 20-turn horizon but
      // nowhere near the MAJOR tier's 150-turn one — only one $queryRaw
      // call should happen at all (MAJOR's cutoff is negative, so it
      // short-circuits before ever querying).
      vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([])
      await consolidateOldMemories('campaign-1', simTurn(25))
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1)
    })

    it('consolidates old MAJOR/CRITICAL memories once the campaign is old enough, tagged with MAJOR importance', async () => {
      const majorRows = [
        makeRow({ id: 'a', turnNumber: 1, title: 'A faction fell' }),
        makeRow({ id: 'b', turnNumber: 25 }),
        makeRow({ id: 'c', turnNumber: 49 }),
      ]
      // First call: MINOR tier, nothing eligible. Second call: MAJOR tier.
      vi.mocked(prisma.$queryRaw)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(majorRows)

      const result = await consolidateOldMemories('campaign-1', simTurn(300))

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2)
      expect(result).toEqual({ bucketsConsolidated: 1, memoriesRemoved: 3 })

      const call = vi.mocked(createCampaignMemory).mock.calls[0][0]
      expect(call.importance).toBe('MAJOR') // not NORMAL, unlike the MINOR tier's summary
      expect(call.title).toContain('major events')
      expect(call.summary).toContain('A consequential stretch')
    })

    it('is independent of the MINOR tier — a MAJOR-tier query failure does not erase a successful MINOR-tier result', async () => {
      const minorRows = [
        makeRow({ id: 'a', turnNumber: 1 }),
        makeRow({ id: 'b', turnNumber: 4 }),
        makeRow({ id: 'c', turnNumber: 8 }),
      ]
      vi.mocked(prisma.$queryRaw)
        .mockResolvedValueOnce(minorRows) // MINOR tier succeeds
        .mockRejectedValueOnce(new Error('db down')) // MAJOR tier fails

      const result = await consolidateOldMemories('campaign-1', simTurn(300))

      // The MINOR tier's real, successful consolidation must still be
      // reported — a failure in the OTHER tier must not zero it out.
      expect(result).toEqual({ bucketsConsolidated: 1, memoriesRemoved: 3 })
    })

    it('does not delete the source memories when era-summary creation fails, and does not count that bucket', async () => {
      // Found live-verifying this fix: createCampaignMemory fails open, so
      // the original code (unconditional create-then-delete) would have
      // silently deleted real memories whose replacement summary never
      // actually got written on a transient embedding/DB failure.
      const rows = [
        makeRow({ id: 'a', turnNumber: 1 }),
        makeRow({ id: 'b', turnNumber: 4 }),
        makeRow({ id: 'c', turnNumber: 8 }),
      ]
      vi.mocked(prisma.$queryRaw).mockResolvedValueOnce(rows)
      vi.mocked(createCampaignMemory).mockResolvedValueOnce(null)

      const result = await consolidateOldMemories('campaign-1', simTurn(25))

      expect(result).toEqual({ bucketsConsolidated: 0, memoriesRemoved: 0 })
      expect(prisma.$executeRaw).not.toHaveBeenCalled()
    })
  })
})

// ---------------------------------------------------------------------------
// #392: consolidation compacts the index, it does not destroy the record
// ---------------------------------------------------------------------------
//
// It used to DELETE the originals, irreversibly destroying each memory's
// fullContext, emotionalTone, importance, memoryType, sourceId,
// retrievalCount, tags and its own turnNumber — and unioning entity
// attribution across the bucket, so "who was in what" became "who was in
// this decade". None of that is derivable from the summary, which is a
// list of headlines, and there was no path back.

describe('consolidateOldMemories — archival, not deletion (#392)', () => {
  it('never issues a DELETE against campaign_memories', async () => {
    vi.clearAllMocks()
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([
      makeRow({ id: 'a', turnNumber: 1 }),
      makeRow({ id: 'b', turnNumber: 4 }),
      makeRow({ id: 'c', turnNumber: 8 }),
      makeRow({ id: 'd', turnNumber: 10 }),
    ])
    vi.mocked(createCampaignMemory).mockResolvedValue('era-1')

    await consolidateOldMemories('campaign-1', simTurn(25))

    const sql = vi.mocked(prisma.$executeRaw).mock.calls
      .map((call) => (call[0] as unknown as string[]).join(''))
      .join('\n')
    expect(sql).not.toMatch(/DELETE\s+FROM\s+campaign_memories/i)
  })

  it('drops only the embedding and marks the row archived', async () => {
    // The 1536-dimension vector is the bulk of the row and the only part
    // that competes in the RAG candidate pool. Everything else is small
    // and irreplaceable.
    vi.clearAllMocks()
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([
      makeRow({ id: 'a', turnNumber: 1 }),
      makeRow({ id: 'b', turnNumber: 4 }),
      makeRow({ id: 'c', turnNumber: 8 }),
      makeRow({ id: 'd', turnNumber: 10 }),
    ])
    vi.mocked(createCampaignMemory).mockResolvedValue('era-1')

    await consolidateOldMemories('campaign-1', simTurn(25))

    const sql = (vi.mocked(prisma.$executeRaw).mock.calls[0][0] as unknown as string[]).join('')
    expect(sql).toMatch(/embedding = NULL/)
    expect(sql).toMatch(/"archivedAt" = NOW\(\)/)
    expect(sql).toMatch(/"consolidatedIntoId"/)
  })
})
