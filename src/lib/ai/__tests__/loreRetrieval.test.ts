import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: vi.fn(),
  },
}))

vi.mock('../embeddingService', () => ({
  generateEmbedding: vi.fn().mockResolvedValue(new Array(1536).fill(0.01)),
  embeddingToPostgresVector: vi.fn((embedding: number[]) => `[${embedding.join(',')}]`),
}))

import { prisma } from '@/lib/prisma'
import { generateEmbedding } from '../embeddingService'
import { retrieveRelevantLore } from '../loreRetrieval'

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
    expect(generateEmbedding).not.toHaveBeenCalled()
    expect(db.$queryRaw).not.toHaveBeenCalled()
  })

  it('embeds the query and returns entries above the similarity threshold', async () => {
    db.$queryRaw.mockResolvedValue([
      makeEntry({ id: 'a', similarity: 0.9 }),
      makeEntry({ id: 'b', similarity: 0.5 }),
    ])

    const result = await retrieveRelevantLore('camp1', 'what do we know about essence magic?', { minSimilarity: 0.7 })

    expect(generateEmbedding).toHaveBeenCalledWith('what do we know about essence magic?')
    expect(result.map((e) => e.id)).toEqual(['a'])
  })

  it('caps results at maxEntries', async () => {
    db.$queryRaw.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => makeEntry({ id: `e${i}`, similarity: 0.9 }))
    )
    const result = await retrieveRelevantLore('camp1', 'query', { maxEntries: 3, minSimilarity: 0.5 })
    expect(result).toHaveLength(3)
  })

  it('returns [] instead of throwing when the DB call fails', async () => {
    db.$queryRaw.mockRejectedValue(new Error('pgvector unavailable'))
    const result = await retrieveRelevantLore('camp1', 'query')
    expect(result).toEqual([])
  })
})
