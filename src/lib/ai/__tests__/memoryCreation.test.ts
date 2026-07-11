import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $executeRaw: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('../embeddingService', () => ({
  generateEmbedding: vi.fn().mockResolvedValue(new Array(1536).fill(0.01)),
  embeddingToPostgresVector: vi.fn((embedding: number[]) => `[${embedding.join(',')}]`),
}))

vi.mock('../cost-tracker', () => ({
  recordAICost: vi.fn().mockResolvedValue(undefined),
  estimateTokenCount: vi.fn().mockReturnValue(10),
}))

import { prisma } from '@/lib/prisma'
import { generateEmbedding } from '../embeddingService'
import { createCampaignMemory, type MemoryData } from '../memoryCreation'

function makeMemoryData(overrides: Partial<MemoryData> = {}): MemoryData {
  return {
    campaignId: 'campaign-1',
    memoryType: 'SCENE',
    sourceId: 'scene-1',
    turnNumber: 3,
    title: 'A scene happened',
    summary: 'Something happened in the scene.',
    fullContext: 'Full text of the scene resolution.',
    involvedCharacterIds: [],
    involvedNpcIds: [],
    involvedFactionIds: [],
    locationTags: [],
    importance: 'NORMAL',
    tags: [],
    ...overrides,
  }
}

describe('createCampaignMemory (baseline)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('embeds the summary text, not the full context', async () => {
    const data = makeMemoryData({ summary: 'short summary', fullContext: 'much longer full context text' })
    await createCampaignMemory(data)
    expect(generateEmbedding).toHaveBeenCalledWith('short summary')
  })

  it('writes exactly one row via raw SQL', async () => {
    await createCampaignMemory(makeMemoryData())
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1)
  })

  it('does not throw when embedding generation fails', async () => {
    vi.mocked(generateEmbedding).mockRejectedValueOnce(new Error('embedding service down'))
    await expect(createCampaignMemory(makeMemoryData())).resolves.toBeUndefined()
    expect(prisma.$executeRaw).not.toHaveBeenCalled()
  })

  it('does not throw when the DB write fails', async () => {
    vi.mocked(prisma.$executeRaw).mockRejectedValueOnce(new Error('db down'))
    await expect(createCampaignMemory(makeMemoryData())).resolves.toBeUndefined()
  })
})
