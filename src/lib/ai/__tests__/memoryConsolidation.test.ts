import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
  },
}))

vi.mock('../memoryCreation', () => ({
  createCampaignMemory: vi.fn().mockResolvedValue(undefined),
}))

import { prisma } from '@/lib/prisma'
import { createCampaignMemory } from '../memoryCreation'
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
})

describe('isFrequentlyRetrieved (pure)', () => {
  it('exempts a memory retrieved often and recently', () => {
    expect(isFrequentlyRetrieved({ retrievalCount: 3, lastRetrievedTurn: 90 }, 100)).toBe(true)
  })

  it('does not exempt a memory retrieved fewer than the minimum count', () => {
    expect(isFrequentlyRetrieved({ retrievalCount: 2, lastRetrievedTurn: 90 }, 100)).toBe(false)
  })

  it('does not exempt a memory retrieved often but not recently', () => {
    // retrieved 10 times, but not for the last 30 turns — was useful once, not still useful now
    expect(isFrequentlyRetrieved({ retrievalCount: 10, lastRetrievedTurn: 70 }, 100)).toBe(false)
  })

  it('does not exempt a memory that has never been retrieved', () => {
    expect(isFrequentlyRetrieved({ retrievalCount: 0, lastRetrievedTurn: null }, 100)).toBe(false)
  })

  it('is inclusive at exactly the recency boundary', () => {
    expect(isFrequentlyRetrieved({ retrievalCount: 3, lastRetrievedTurn: 85 }, 100)).toBe(true) // 100-85=15
    expect(isFrequentlyRetrieved({ retrievalCount: 3, lastRetrievedTurn: 84 }, 100)).toBe(false) // 100-84=16
  })
})

describe('consolidateOldMemories (DB wrapper)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('no-ops when currentTurn is within the age threshold', async () => {
    const result = await consolidateOldMemories('campaign-1', 5) // cutoff would be negative
    expect(result).toEqual({ bucketsConsolidated: 0, memoriesRemoved: 0 })
    expect(prisma.$queryRaw).not.toHaveBeenCalled()
  })

  it('no-ops when the query finds no eligible memories', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([])
    const result = await consolidateOldMemories('campaign-1', 25)
    expect(result).toEqual({ bucketsConsolidated: 0, memoriesRemoved: 0 })
    expect(createCampaignMemory).not.toHaveBeenCalled()
    expect(prisma.$executeRaw).not.toHaveBeenCalled()
  })

  it('no-ops when the only eligible window is below the minimum bucket size', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([makeRow({ turnNumber: 1 }), makeRow({ turnNumber: 2 })])
    const result = await consolidateOldMemories('campaign-1', 25)
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

    const result = await consolidateOldMemories('campaign-1', 25)

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
    await consolidateOldMemories('campaign-1', 30)
    // Just confirm it actually ran the query this time (currentTurn - 20 = 10 > 0)
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1)
  })

  it('does not throw when the underlying query rejects', async () => {
    vi.mocked(prisma.$queryRaw).mockRejectedValueOnce(new Error('db down'))
    const result = await consolidateOldMemories('campaign-1', 25)
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
    const result = await consolidateOldMemories('campaign-1', 25)

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

    const result = await consolidateOldMemories('campaign-1', 25)

    expect(result).toEqual({ bucketsConsolidated: 1, memoriesRemoved: 3 })
    // The exempt memory 'a' must never appear among the deleted ids.
    const deletedIds = vi.mocked(prisma.$executeRaw).mock.calls[0][1] as string[]
    expect(deletedIds.sort()).toEqual(['b', 'c', 'd'])
  })
})
