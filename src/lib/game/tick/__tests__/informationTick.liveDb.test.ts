// src/lib/game/tick/__tests__/informationTick.liveDb.test.ts
//
// #101 (PR 2/3): exercises tickInformation against real Postgres end to
// end — a real significant WorldEvent, a real two-location adjacency
// graph, and a real character not present when it happened. Every other
// informationTick test mocks Prisma, which never forces the real
// EventWitness insert (and its @@unique/skipDuplicates interaction) to
// surface.
//
// Opt-in, matching the repo's other *.liveDb.test.ts files:
//
//   RUN_DB_TESTS=1 npx vitest run informationTick.liveDb

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { tickInformation } from '../informationTick'
import type { TickContext } from '../types'
import { simTurn } from '@/lib/game/turnClock'

const RUN = process.env.RUN_DB_TESTS === '1'
const describeIfDb = RUN ? describe : describe.skip

describeIfDb('tickInformation — real database (#101)', () => {
  const prisma = new PrismaClient()
  let campaignId: string
  let userId: string
  let originLocationId: string
  let farLocationId: string
  let characterId: string
  let npcId: string
  let worldEventId: string

  beforeAll(async () => {
    const campaign = await prisma.campaign.create({
      data: { title: 'Information Latency Live Test', aiSystemPrompt: 'test', initialWorldSeed: 'test' },
    })
    campaignId = campaign.id

    const user = await prisma.user.create({
      data: { email: `information-tick-live-${Date.now()}@example.com`, name: 'Info Tester' },
    })
    userId = user.id

    const origin = await prisma.location.create({
      data: { campaignId, name: 'The Burning Hall', isDiscovered: true },
    })
    originLocationId = origin.id

    const far = await prisma.location.create({
      data: { campaignId, name: 'The Quiet Port', isDiscovered: true },
    })
    farLocationId = far.id

    // Canonicalized A < B, matching this schema's documented convention.
    const [locationAId, locationBId] = originLocationId < farLocationId
      ? [originLocationId, farLocationId]
      : [farLocationId, originLocationId]
    await prisma.locationAdjacency.create({
      data: { campaignId, locationAId, locationBId, distance: 1 },
    })

    const character = await prisma.character.create({
      data: { campaignId, userId, name: 'Wren', locationId: farLocationId },
    })
    characterId = character.id

    const npc = await prisma.nPC.create({
      data: { campaignId, name: 'Old Harl', locationId: farLocationId, isAlive: true },
    })
    npcId = npc.id

    const event = await prisma.worldEvent.create({
      data: {
        campaignId, turnNumber: 5, type: 'location.condition', origin: 'tick', actorType: 'SYSTEM',
        targetType: 'LOCATION', targetId: originLocationId, targetName: 'The Burning Hall',
        field: 'conditionScore', previousValue: '80', newValue: '20',
        reason: 'The Burning Hall was put to the torch', significant: true, importance: 'MAJOR',
      },
    })
    worldEventId = event.id
  })

  afterAll(async () => {
    await prisma.campaign.delete({ where: { id: campaignId } }).catch(() => {})
    await prisma.user.delete({ where: { id: userId } }).catch(() => {})
    await prisma.$disconnect()
  })

  it('writes a real TOLD EventWitness row for both a Character and an NPC once the graph-derived delay has elapsed', async () => {
    expect(await prisma.eventWitness.count({ where: { campaignId } })).toBe(0)

    // distance 1 -> delay = 1 (base) + 1 = 2. Turn 6 (age 1) is too early.
    const tooEarly: TickContext = { campaignId, turnNumber: simTurn(6), factionCap: 10, npcCap: 20, dryRun: false, db: prisma as any }
    await tickInformation(tooEarly)
    expect(await prisma.eventWitness.count({ where: { campaignId } })).toBe(0)

    // Turn 7 (age 2) fires.
    const onTime: TickContext = { campaignId, turnNumber: simTurn(7), factionCap: 10, npcCap: 20, dryRun: false, db: prisma as any }
    await tickInformation(onTime)

    const witnesses = await prisma.eventWitness.findMany({ where: { campaignId } })
    expect(witnesses).toHaveLength(2)
    expect(witnesses).toContainEqual(expect.objectContaining({
      worldEventId, characterId, npcId: null, grade: 'TOLD', turnNumber: 7,
    }))
    expect(witnesses).toContainEqual(expect.objectContaining({
      worldEventId, npcId, characterId: null, grade: 'TOLD', turnNumber: 7,
    }))
  })

  it('is idempotent: running it again does not create a duplicate row', async () => {
    const ctx: TickContext = { campaignId, turnNumber: simTurn(8), factionCap: 10, npcCap: 20, dryRun: false, db: prisma as any }
    await tickInformation(ctx)

    expect(await prisma.eventWitness.count({ where: { campaignId, worldEventId, characterId } })).toBe(1)
  })
})
