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
    // #377 changed createCampaignMemory's contract from `boolean` to the
    // created row's id (or null) — the dedupe path needs the id of the row
    // that already existed, not just "did something happen". Asserting the
    // id is a string is a strictly stronger check than the old `toBe(true)`.
    expect(typeof closeCreated).toBe('string')
    expect(typeof farCreated).toBe('string')

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
    expect(result[0].similarity!).toBeGreaterThan(result[1].similarity!)
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

  // #285/#327: retrieveRelevantHistory used to filter only by campaignId
  // and entity-id overlap — no isDiscovered check at all. A memory
  // referencing a currently-undiscovered NPC could in principle be pulled
  // into the prompt by semantic similarity alone, leaking fog-gated
  // information into player-facing narration.
  it('excludes a memory referencing an undiscovered NPC, even when it is otherwise the closest semantic match', async () => {
    const { createCampaignMemory } = await import('@/lib/ai/memoryCreation')
    const { retrieveRelevantHistory } = await import('../memoryRetrieval')

    const hiddenNpc = await prisma.nPC.create({
      data: { campaignId, name: 'The Hidden Cultist', isDiscovered: false },
    })
    const knownNpc = await prisma.nPC.create({
      data: { campaignId, name: 'The Known Blacksmith', isDiscovered: true },
    })

    await createCampaignMemory({
      campaignId, memoryType: 'WORLD_EVENT', sourceId: 'test-source', turnNumber: 3,
      title: 'Undiscovered NPC memory', summary: 'TOPIC_A memory about the hidden cultist', fullContext: 'TOPIC_A',
      involvedCharacterIds: [], involvedNpcIds: [hiddenNpc.id], involvedFactionIds: [], locationTags: [],
      importance: 'NORMAL', tags: [],
    })
    await createCampaignMemory({
      campaignId, memoryType: 'WORLD_EVENT', sourceId: 'test-source', turnNumber: 3,
      title: 'Discovered NPC memory', summary: 'TOPIC_A memory about the known blacksmith', fullContext: 'TOPIC_A',
      involvedCharacterIds: [], involvedNpcIds: [knownNpc.id], involvedFactionIds: [], locationTags: [],
      importance: 'NORMAL', tags: [],
    })

    const scene = await prisma.scene.create({ data: { campaignId, sceneNumber: 3, sceneIntroText: 'x' } })

    const result = await retrieveRelevantHistory(
      campaignId,
      { currentScene: scene, playerActions: [], characters: [], npcs: [{ id: hiddenNpc.id }, { id: knownNpc.id }] as any, factions: [] },
      { minSimilarity: -1, recencyBias: 0 },
      'a query about TOPIC_A'
    )

    const titles = result.map((r) => r.title)
    expect(titles).toContain('Discovered NPC memory')
    expect(titles).not.toContain('Undiscovered NPC memory')
  })

  // #293: the ORDER BY blends similarity and recency in one expression —
  // nothing proved that blend was actually wired to recencyBias rather
  // than being dead weight. Writing this test surfaced a real bug: the
  // blend used to only decide the SQL's own LIMIT-cutoff candidate pool —
  // filterAndRankMemories's importance-boosted re-sort (the default,
  // importanceBoost: true, left un-overridden by both calls below to
  // match production's own call site in sceneResolutionRequest.ts) then
  // unconditionally re-ranked by raw similarity, discarding the blend
  // entirely. Fixed by returning the blend as its own `relevanceScore`
  // column and boosting that instead of raw similarity — see
  // filterAndRankMemories's own comment. A dedicated campaign/turn range
  // keeps this independent of the other memories/turnNumbers created
  // elsewhere in this describe block, since the recency term is
  // normalized against this campaign's own MAX(turnNumber).
  it('lets recencyBias flip the ranking toward a more recent, less similar memory', async () => {
    const { createCampaignMemory } = await import('@/lib/ai/memoryCreation')
    const { retrieveRelevantHistory } = await import('../memoryRetrieval')

    const recencyCampaign = await prisma.campaign.create({
      data: { title: 'RAG Recency Blend Test Campaign', aiSystemPrompt: 'test', initialWorldSeed: 'test' },
    })

    await createCampaignMemory({
      campaignId: recencyCampaign.id, memoryType: 'WORLD_EVENT', sourceId: 'test-source', turnNumber: 1,
      title: 'Old similar memory', summary: 'TOPIC_A memory content', fullContext: 'TOPIC_A memory content',
      involvedCharacterIds: [], involvedNpcIds: [], involvedFactionIds: [], locationTags: [],
      importance: 'NORMAL', tags: [],
    })
    await createCampaignMemory({
      campaignId: recencyCampaign.id, memoryType: 'WORLD_EVENT', sourceId: 'test-source', turnNumber: 50,
      title: 'Recent dissimilar memory', summary: 'TOPIC_B memory content', fullContext: 'TOPIC_B memory content',
      involvedCharacterIds: [], involvedNpcIds: [], involvedFactionIds: [], locationTags: [],
      importance: 'NORMAL', tags: [],
    })

    const scene = await prisma.scene.create({
      data: { campaignId: recencyCampaign.id, sceneNumber: 1, sceneIntroText: 'x' },
    })

    // minSimilarity: -1 admits both regardless of raw similarity, so only
    // the ORDER BY blend decides which ranks first.
    const pureSimilarity = await retrieveRelevantHistory(
      recencyCampaign.id,
      { currentScene: scene, playerActions: [], characters: [], npcs: [], factions: [] },
      { minSimilarity: -1, recencyBias: 0 },
      'a query about TOPIC_A'
    )
    expect(pureSimilarity[0].title).toBe('Old similar memory')

    const pureRecency = await retrieveRelevantHistory(
      recencyCampaign.id,
      { currentScene: scene, playerActions: [], characters: [], npcs: [], factions: [] },
      { minSimilarity: -1, recencyBias: 1 },
      'a query about TOPIC_A'
    )
    expect(pureRecency[0].title).toBe('Recent dissimilar memory')

    await prisma.campaign.delete({ where: { id: recencyCampaign.id } }).catch(() => {})
  })
})

describeIfDb('retrieveNpcHistory — real fog-of-war guard (#285/#327)', () => {
  const prisma = new PrismaClient()
  let campaignId: string

  beforeAll(async () => {
    const campaign = await prisma.campaign.create({
      data: { title: 'RAG NPC History Test Campaign', aiSystemPrompt: 'test', initialWorldSeed: 'test' },
    })
    campaignId = campaign.id
  })

  afterAll(async () => {
    await prisma.campaign.delete({ where: { id: campaignId } }).catch(() => {})
    await prisma.$disconnect()
  })

  it('returns nothing for an undiscovered NPC, even though a real memory references them', async () => {
    const { createCampaignMemory } = await import('@/lib/ai/memoryCreation')
    const { retrieveNpcHistory } = await import('../memoryRetrieval')

    const hiddenNpc = await prisma.nPC.create({
      data: { campaignId, name: 'The Hidden Cultist', isDiscovered: false },
    })
    await createCampaignMemory({
      campaignId, memoryType: 'WORLD_EVENT', sourceId: 'test-source', turnNumber: 1,
      title: 'A memory about the hidden cultist', summary: 's', fullContext: 'f',
      involvedCharacterIds: [], involvedNpcIds: [hiddenNpc.id], involvedFactionIds: [], locationTags: [],
      importance: 'NORMAL', tags: [],
    })

    const result = await retrieveNpcHistory(campaignId, hiddenNpc.id)
    expect(result).toEqual([])
  })

  it('returns real history for a discovered NPC', async () => {
    const { createCampaignMemory } = await import('@/lib/ai/memoryCreation')
    const { retrieveNpcHistory } = await import('../memoryRetrieval')

    const knownNpc = await prisma.nPC.create({
      data: { campaignId, name: 'The Known Blacksmith', isDiscovered: true },
    })
    await createCampaignMemory({
      campaignId, memoryType: 'WORLD_EVENT', sourceId: 'test-source', turnNumber: 1,
      title: 'A memory about the known blacksmith', summary: 's', fullContext: 'f',
      involvedCharacterIds: [], involvedNpcIds: [knownNpc.id], involvedFactionIds: [], locationTags: [],
      importance: 'NORMAL', tags: [],
    })

    const result = await retrieveNpcHistory(campaignId, knownNpc.id)
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('A memory about the known blacksmith')
  })
})
