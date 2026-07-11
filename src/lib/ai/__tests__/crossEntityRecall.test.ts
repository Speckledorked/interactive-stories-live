import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: vi.fn(),
  },
}))

import { prisma } from '@/lib/prisma'
import { generateEntityPairs, retrieveCrossEntityHistory } from '../memoryRetrieval'

describe('generateEntityPairs (pure)', () => {
  it('returns no pairs for fewer than two IDs', () => {
    expect(generateEntityPairs([])).toEqual([])
    expect(generateEntityPairs(['a'])).toEqual([])
  })

  it('returns the single pair for exactly two IDs', () => {
    expect(generateEntityPairs(['a', 'b'])).toEqual([['a', 'b']])
  })

  it('returns every unique unordered pair for three or more IDs', () => {
    const pairs = generateEntityPairs(['a', 'b', 'c'])
    expect(pairs).toHaveLength(3)
    expect(pairs).toEqual(
      expect.arrayContaining([
        ['a', 'b'],
        ['a', 'c'],
        ['b', 'c'],
      ])
    )
  })

  it('de-duplicates repeated IDs before pairing', () => {
    const pairs = generateEntityPairs(['a', 'a', 'b'])
    expect(pairs).toEqual([['a', 'b']])
  })

  it('never produces a pair of an entity with itself', () => {
    const pairs = generateEntityPairs(['a', 'b', 'c', 'd'])
    for (const [x, y] of pairs) {
      expect(x).not.toBe(y)
    }
  })
})

describe('retrieveCrossEntityHistory (DB wrapper)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the rows the query produces', async () => {
    const rows = [{ id: 'mem-1', turnNumber: 5, title: 'Shared history', summary: 's', memoryType: 'SCENE', importance: 'NORMAL', emotionalTone: null, similarity: 1.0 }]
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce(rows)

    const result = await retrieveCrossEntityHistory('campaign-1', 'npc-a', 'faction-b', 5)

    expect(result).toEqual(rows)
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1)
  })

  it('returns an empty array rather than throwing when the query fails', async () => {
    vi.mocked(prisma.$queryRaw).mockRejectedValueOnce(new Error('db down'))
    const result = await retrieveCrossEntityHistory('campaign-1', 'npc-a', 'npc-b')
    expect(result).toEqual([])
  })
})
