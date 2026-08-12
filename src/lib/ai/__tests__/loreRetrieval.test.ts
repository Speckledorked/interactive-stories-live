import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: vi.fn(),
    loreCitation: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
  },
}))

vi.mock('../embeddingService', () => ({
  embedWithCostTracking: vi.fn().mockResolvedValue('[0.01,0.01,0.01]'),
}))

import { prisma } from '@/lib/prisma'
import { embedWithCostTracking } from '../embeddingService'
import { retrieveRelevantLore, recordLoreCitations } from '../loreRetrieval'

const db = prisma as any

function makeEntry(overrides: Partial<any> = {}) {
  return {
    id: 'lore-1',
    title: 'Essence Magic',
    content: 'Magic drawn from world essence.',
    sourceUrl: null,
    similarity: 0.8,
    ...overrides,
  }
}

describe('retrieveRelevantLore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns [] without querying when the query text is empty/whitespace', async () => {
    const result = await retrieveRelevantLore('camp1', '   ')
    expect(result).toEqual([])
    expect(embedWithCostTracking).not.toHaveBeenCalled()
    expect(db.$queryRaw).not.toHaveBeenCalled()
  })

  it('embeds the query and returns entries above the similarity threshold', async () => {
    db.$queryRaw.mockResolvedValue([
      makeEntry({ id: 'a', similarity: 0.9 }),
      makeEntry({ id: 'b', similarity: 0.5 }),
    ])

    const result = await retrieveRelevantLore('camp1', 'what do we know about essence magic?', { minSimilarity: 0.7 })

    expect(embedWithCostTracking).toHaveBeenCalledWith('camp1', 'what do we know about essence magic?', 'lore_retrieval_embedding')
    expect(result.map((e) => e.id)).toEqual(['a'])
  })

  it('caps results at maxEntries', async () => {
    db.$queryRaw.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => makeEntry({ id: `e${i}`, similarity: 0.9 }))
    )
    const result = await retrieveRelevantLore('camp1', 'query', { maxEntries: 3, minSimilarity: 0.5 })
    expect(result).toHaveLength(3)
  })

  it('defaults to up to 8 entries (raised from 5) when no maxEntries is given', async () => {
    db.$queryRaw.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => makeEntry({ id: `e${i}`, similarity: 0.9 }))
    )
    const result = await retrieveRelevantLore('camp1', 'query')
    expect(result).toHaveLength(8)
  })

  it('returns [] instead of throwing when the DB call fails', async () => {
    db.$queryRaw.mockRejectedValue(new Error('pgvector unavailable'))
    const result = await retrieveRelevantLore('camp1', 'query')
    expect(result).toEqual([])
  })
})

describe('recordLoreCitations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('writes one citation row per retrieved entry, carrying campaign/scene/entry ids and similarity', async () => {
    const entries = [makeEntry({ id: 'a', similarity: 0.91 }), makeEntry({ id: 'b', similarity: 0.77 })]
    await recordLoreCitations('camp1', 'scene1', entries as any)

    expect(db.loreCitation.createMany).toHaveBeenCalledWith({
      data: [
        { campaignId: 'camp1', sceneId: 'scene1', loreEntryId: 'a', similarity: 0.91 },
        { campaignId: 'camp1', sceneId: 'scene1', loreEntryId: 'b', similarity: 0.77 },
      ],
    })
  })

  it('does nothing when there are no entries to cite', async () => {
    await recordLoreCitations('camp1', 'scene1', [])
    expect(db.loreCitation.createMany).not.toHaveBeenCalled()
  })

  it('never throws when the write itself fails — a citation-write failure must not affect scene resolution', async () => {
    db.loreCitation.createMany.mockRejectedValue(new Error('DB unavailable'))
    await expect(recordLoreCitations('camp1', 'scene1', [makeEntry()] as any)).resolves.toBeUndefined()
  })
})
