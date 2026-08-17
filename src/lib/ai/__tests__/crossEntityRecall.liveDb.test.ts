// src/lib/ai/__tests__/crossEntityRecall.liveDb.test.ts
// #285/#327: retrieveCrossEntityHistory's raw SQL used to filter only by
// campaignId and entity-id membership — no isDiscovered check for either
// side of the pair. Its own mocked unit test (crossEntityRecall.test.ts)
// only ever asserts prisma.$queryRaw was called, never the real SQL text,
// so this is the only place the new NOT EXISTS guards' actual syntax and
// behavior get exercised — against real Postgres, real NPC/Faction rows.
//
// Opt-in, same convention as the other *.liveDb.test.ts files.
//
//   RUN_DB_TESTS=1 npx vitest run crossEntityRecall.liveDb

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { simTurn } from '@/lib/game/turnClock'

// retrieveCrossEntityHistory never touches embeddings itself (it's a plain
// id/EXISTS filter, not a similarity search — see the hardcoded
// `1.0 as similarity` in its SELECT), but createCampaignMemory, used here
// just to seed rows, always generates one on the way in. This environment
// has no real OPENAI_API_KEY, so leaving it unmocked makes every memory
// silently fail to insert (embeddingService catches and createCampaignMemory
// fails open), which is what turned every "returns real history" case here
// into a false negative. The actual vector value is irrelevant to what
// these tests assert, so a fixed stub is enough.
vi.mock('@/lib/ai/embeddingService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/embeddingService')>()
  return {
    ...actual,
    embedWithCostTracking: vi.fn(async () =>
      actual.embeddingToPostgresVector(new Array(1536).fill(0.001))
    ),
  }
})

const RUN = process.env.RUN_DB_TESTS === '1'
const describeIfDb = RUN ? describe : describe.skip

describeIfDb('retrieveCrossEntityHistory — real fog-of-war guard', () => {
  const prisma = new PrismaClient()
  let campaignId: string

  beforeAll(async () => {
    const campaign = await prisma.campaign.create({
      data: { title: 'Cross-Entity Recall Test Campaign', aiSystemPrompt: 'test', initialWorldSeed: 'test' },
    })
    campaignId = campaign.id
  })

  afterAll(async () => {
    await prisma.campaign.delete({ where: { id: campaignId } }).catch(() => {})
    await prisma.$disconnect()
  })

  it('excludes a memory when either paired entity is an undiscovered NPC', async () => {
    const { createCampaignMemory } = await import('@/lib/ai/memoryCreation')
    const { retrieveCrossEntityHistory } = await import('../crossEntityRecall')

    const hiddenNpc = await prisma.nPC.create({ data: { campaignId, name: 'Hidden One', isDiscovered: false } })
    const knownNpc = await prisma.nPC.create({ data: { campaignId, name: 'Known One', isDiscovered: true } })

    await createCampaignMemory({
      campaignId, memoryType: 'WORLD_EVENT', sourceId: 'test-source', turnNumber: simTurn(1),
      title: 'History with a hidden NPC', summary: 's', fullContext: 'f',
      involvedCharacterIds: [], involvedNpcIds: [hiddenNpc.id, knownNpc.id], involvedFactionIds: [], locationTags: [],
      importance: 'NORMAL', tags: [],
    })

    const result = await retrieveCrossEntityHistory(campaignId, hiddenNpc.id, knownNpc.id)
    expect(result).toEqual([])
  })

  it('excludes a memory when either paired entity is an undiscovered faction', async () => {
    const { createCampaignMemory } = await import('@/lib/ai/memoryCreation')
    const { retrieveCrossEntityHistory } = await import('../crossEntityRecall')

    const hiddenFaction = await prisma.faction.create({ data: { campaignId, name: 'Hidden Cabal', isDiscovered: false } })
    const knownNpc = await prisma.nPC.create({ data: { campaignId, name: 'Known Two', isDiscovered: true } })

    await createCampaignMemory({
      campaignId, memoryType: 'WORLD_EVENT', sourceId: 'test-source', turnNumber: simTurn(2),
      title: 'History with a hidden faction', summary: 's', fullContext: 'f',
      involvedCharacterIds: [], involvedNpcIds: [knownNpc.id], involvedFactionIds: [hiddenFaction.id], locationTags: [],
      importance: 'NORMAL', tags: [],
    })

    const result = await retrieveCrossEntityHistory(campaignId, knownNpc.id, hiddenFaction.id)
    expect(result).toEqual([])
  })

  it('returns real history when both paired entities are discovered', async () => {
    const { createCampaignMemory } = await import('@/lib/ai/memoryCreation')
    const { retrieveCrossEntityHistory } = await import('../crossEntityRecall')

    const npcA = await prisma.nPC.create({ data: { campaignId, name: 'Alpha', isDiscovered: true } })
    const npcB = await prisma.nPC.create({ data: { campaignId, name: 'Beta', isDiscovered: true } })

    await createCampaignMemory({
      campaignId, memoryType: 'WORLD_EVENT', sourceId: 'test-source', turnNumber: simTurn(3),
      title: 'History between two discovered NPCs', summary: 's', fullContext: 'f',
      involvedCharacterIds: [], involvedNpcIds: [npcA.id, npcB.id], involvedFactionIds: [], locationTags: [],
      importance: 'NORMAL', tags: [],
    })

    const result = await retrieveCrossEntityHistory(campaignId, npcA.id, npcB.id)
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('History between two discovered NPCs')
  })

  it('passes through a character id, which never matches the NPC/Faction guard tables', async () => {
    const { createCampaignMemory } = await import('@/lib/ai/memoryCreation')
    const { retrieveCrossEntityHistory } = await import('../crossEntityRecall')

    const user = await prisma.user.create({ data: { email: `crossentity-${Date.now()}@example.com`, name: 'Test User' } })
    const character = await prisma.character.create({ data: { campaignId, userId: user.id, name: 'Test PC' } })
    const npc = await prisma.nPC.create({ data: { campaignId, name: 'Gamma', isDiscovered: true } })

    await createCampaignMemory({
      campaignId, memoryType: 'WORLD_EVENT', sourceId: 'test-source', turnNumber: simTurn(4),
      title: 'History between a PC and an NPC', summary: 's', fullContext: 'f',
      involvedCharacterIds: [character.id], involvedNpcIds: [npc.id], involvedFactionIds: [], locationTags: [],
      importance: 'NORMAL', tags: [],
    })

    const result = await retrieveCrossEntityHistory(campaignId, character.id, npc.id)
    expect(result).toHaveLength(1)

    await prisma.character.delete({ where: { id: character.id } }).catch(() => {})
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {})
  })
})
