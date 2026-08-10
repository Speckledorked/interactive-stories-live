// src/lib/game/tick/__tests__/npcDispositionTick.liveDb.test.ts
//
// Real-database verification for the NPC motivation model: the first-ever
// production execution of a real NPC.update({ data: { disposition } })
// call, plus confirming the real WorldEvent query shape (turnNumber,
// targetType, targetId) actually matches rows a real WorldChange write
// produces.
//
// Opt-in, matching logisticsTick.liveDb.test.ts's own convention:
//
//   RUN_DB_TESTS=1 npx vitest run npcDispositionTick.liveDb

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { tickNpcDisposition } from '../npcDispositionTick'
import type { TickContext } from '../types'

const RUN = process.env.RUN_DB_TESTS === '1'
const describeIfDb = RUN ? describe : describe.skip

describeIfDb('tickNpcDisposition — real database', () => {
  const prisma = new PrismaClient()
  let campaignId: string
  let factionId: string
  let npcId: string

  beforeAll(async () => {
    const campaign = await prisma.campaign.create({
      data: { title: 'NPC Disposition Live Test', aiSystemPrompt: 'test', initialWorldSeed: 'test' },
    })
    campaignId = campaign.id

    const faction = await prisma.faction.create({
      data: { campaignId, name: 'Ashcrown Company', isActive: true },
    })
    factionId = faction.id

    const npc = await prisma.nPC.create({
      data: { campaignId, name: 'Bram the Lieutenant', importance: 5, isAlive: true, factionId },
    })
    npcId = npc.id
  })

  afterAll(async () => {
    await prisma.campaign.delete({ where: { id: campaignId } }).catch(() => {})
    await prisma.$disconnect()
  })

  it('drifts and persists a real disposition from a real prior-turn WorldEvent', async () => {
    const npcBefore = await prisma.nPC.findUnique({ where: { id: npcId }, select: { disposition: true } })
    expect(npcBefore?.disposition).toBeNull()

    await prisma.worldEvent.create({
      data: {
        campaignId,
        turnNumber: 1,
        type: 'npc.consequence',
        origin: 'consequence',
        targetType: 'NPC',
        targetId: npcId,
        targetName: 'Bram the Lieutenant',
        field: 'consequence',
        previousValue: '(none)',
        newValue: 'THREATENED',
        reason: 'The party threatened Bram',
        significant: true,
        importance: 'NORMAL',
      },
    })

    const ctx: TickContext = {
      campaignId, turnNumber: 2, factionCap: 10, npcCap: 20, dryRun: false, db: prisma as any,
    }
    const result = await tickNpcDisposition(ctx)

    expect(result.changes).toHaveLength(1)
    expect(result.changes[0]).toMatchObject({ entityType: 'NPC', entityId: npcId, field: 'disposition' })

    const npcAfter = await prisma.nPC.findUnique({ where: { id: npcId }, select: { disposition: true } })
    expect(npcAfter?.disposition).toMatchObject({ selfPreservation: 54, loyalty: 50, ambition: 50 })
  })

  it('reads the affiliated faction\'s own prior-turn events too, drifting loyalty/ambition', async () => {
    await prisma.worldEvent.create({
      data: {
        campaignId,
        turnNumber: 2,
        type: 'faction.warResolved',
        origin: 'tick',
        targetType: 'FACTION',
        targetId: factionId,
        targetName: 'Ashcrown Company',
        field: 'warResolved',
        previousValue: null,
        newValue: 'attacker',
        reason: 'Ashcrown Company wins the war',
        significant: true,
        importance: 'MAJOR',
      },
    })

    const ctx: TickContext = {
      campaignId, turnNumber: 3, factionCap: 10, npcCap: 20, dryRun: false, db: prisma as any,
    }
    const result = await tickNpcDisposition(ctx)

    expect(result.changes).toHaveLength(1)

    const npcAfter = await prisma.nPC.findUnique({ where: { id: npcId }, select: { disposition: true } })
    // Starting from the previous test's { selfPreservation: 54, loyalty: 50, ambition: 50 }.
    expect(npcAfter?.disposition).toMatchObject({ loyalty: 54, ambition: 54 })
  })
})
