// src/lib/ai/__tests__/memoryRetrieval.liveDb.test.ts
// #240 (adversarial audit): retrieveRelevantHistory — the function that
// actually issues the pgvector cosine-similarity query — had zero test
// coverage anywhere. Only its pure post-processing helper
// (filterAndRankMemories) was unit-tested; the real `<=>` SQL, blended
// with the recency term in the same ORDER BY, was never exercised by any
// test. This is the "genuine pgvector search" claim's actual proof: real
// rows, a real vector column, a real query, against a real Postgres
// instance.
//
// Opt-in, same convention as the other *.liveDb.test.ts files: no-ops
// unless RUN_DB_TESTS=1 and DATABASE_URL point at a real pgvector-enabled
// database (see .github/workflows/ci.yml's db-tests job).
//
//   RUN_DB_TESTS=1 npx vitest run memoryRetrieval.liveDb

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'

// The embedding call itself needs a real OPENAI_API_KEY this environment
// doesn't have — mocked to a controlled, deterministic vector keyed off
// the input text, so the DB/SQL layer underneath (the actual thing this
// test exists to prove) is exercised for real. embeddingToPostgresVector
// stays real: it's a pure string-format function, no reason to fake it.
vi.mock('@/lib/ai/embeddingService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/embeddingService')>()
  return {
    ...actual,
    embedWithCostTracking: vi.fn(async (_campaignId: string, text: string) => {
      const vector = text.includes('TOPIC_A')
        ? VECTOR_A
        : text.includes('TOPIC_B')
          ? VECTOR_B
          : VECTOR_NEUTRAL
      return actual.embeddingToPostgresVector(vector)
    }),
  }
})

const DIMENSIONS = 1536
// Two orthogonal one-hot vectors: cosine similarity between A and B is
// exactly 0 (`1 - 0 = 1` cosine *distance*), while a vector compared
// against itself is exactly 1 — a controlled, unambiguous way to prove
// the real pgvector ORDER BY actually ranks by similarity rather than,
// say, insertion order or turnNumber alone.
function oneHot(index: number): number[] {
  const v = new Array(DIMENSIONS).fill(0)
  v[index] = 1
  return v
}
const VECTOR_A = oneHot(0)
const VECTOR_B = oneHot(1)
const VECTOR_NEUTRAL = oneHot(2)

const RUN = process.env.RUN_DB_TESTS === '1'
const describeIfDb = RUN ? describe : describe.skip

describeIfDb('retrieveRelevantHistory — real pgvector search', () => {
  const prisma = new PrismaClient()
  let campaignId: string

  beforeAll(async () => {
    const campaign = await prisma.campaign.create({
      data: { title: 'RAG Test Campaign', aiSystemPrompt: 'test', initialWorldSeed: 'test' },
    })
    campaignId = campaign.id
  })

  afterAll(async () => {
    await prisma.campaign.delete({ where: { id: campaignId } }).catch(() => {})
    await prisma.$disconnect()
  })

  it('ranks a semantically-close memory above a dissimilar one, and filters the dissimilar one out entirely', async () => {
    const { createCampaignMemory } = await import('@/lib/ai/memoryCreation')
    const { retrieveRelevantHistory } = await import('../memoryRetrieval')

    const closeCreated = await createCampaignMemory({
      campaignId,
      memoryType: 'WORLD_EVENT',
      sourceId: 'test-source',
      turnNumber: 1,
      title: 'Close memory',
      summary: 'TOPIC_A memory content',
      fullContext: 'TOPIC_A memory content',
      involvedCharacterIds: [],
      involvedNpcIds: [],
      involvedFactionIds: [],
      locationTags: [],
      importance: 'NORMAL',
      tags: [],
    })
    const farCreated = await createCampaignMemory({
      campaignId,
      memoryType: 'WORLD_EVENT',
      sourceId: 'test-source',
      turnNumber: 1,
      title: 'Far memory',
      summary: 'TOPIC_B memory content',
      fullContext: 'TOPIC_B memory content',
      involvedCharacterIds: [],
      involvedNpcIds: [],
      involvedFactionIds: [],
      locationTags: [],
      importance: 'NORMAL',
      tags: [],
    })
    expect(closeCreated).toBe(true)
    expect(farCreated).toBe(true)

    const scene = await prisma.scene.create({
      data: { campaignId, sceneNumber: 1, sceneIntroText: 'x' },
    })

    const result = await retrieveRelevantHistory(
      campaignId,
      { currentScene: scene, playerActions: [], characters: [], npcs: [], factions: [] },
      { minSimilarity: 0.5, recencyBias: 0 },
      'a query about TOPIC_A' // precomputedQuery -> embeds to VECTOR_A
    )

    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('Close memory')
    // Identical vectors -> cosine similarity should land at (or extremely
    // close to, allowing for floating-point roundtrip through Postgres) 1.
    expect(result[0].similarity).toBeGreaterThan(0.99)
  })

  it('returns both memories, correctly ordered, when the similarity threshold is low enough to admit both', async () => {
    const { retrieveRelevantHistory } = await import('../memoryRetrieval')

    const scene = await prisma.scene.create({
      data: { campaignId, sceneNumber: 2, sceneIntroText: 'x' },
    })

    const result = await retrieveRelevantHistory(
      campaignId,
      { currentScene: scene, playerActions: [], characters: [], npcs: [], factions: [] },
      { minSimilarity: -1, recencyBias: 0 },
      'a query about TOPIC_A'
    )

    expect(result.length).toBeGreaterThanOrEqual(2)
    // The genuinely close one must rank first, not just be present.
    expect(result[0].title).toBe('Close memory')
    expect(result[0].similarity).toBeGreaterThan(result[1].similarity)
  })

  it('gracefully returns an empty array for a campaign with no memories yet', async () => {
    const { retrieveRelevantHistory } = await import('../memoryRetrieval')

    const emptyCampaign = await prisma.campaign.create({
      data: { title: 'Empty RAG Campaign', aiSystemPrompt: 'test', initialWorldSeed: 'test' },
    })
    const scene = await prisma.scene.create({
      data: { campaignId: emptyCampaign.id, sceneNumber: 1, sceneIntroText: 'x' },
    })

    const result = await retrieveRelevantHistory(
      emptyCampaign.id,
      { currentScene: scene, playerActions: [], characters: [], npcs: [], factions: [] },
      {},
      'a query about anything'
    )

    expect(result).toEqual([])
    await prisma.campaign.delete({ where: { id: emptyCampaign.id } }).catch(() => {})
  })
})
