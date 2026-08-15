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

  // #276: this is the exact scenario the frozen-turnNumber bug produces —
  // an idle campaign's daily cron sweep invokes runWorldTick with the SAME
  // turnNumber on every pass, since nothing else ever advances it. Without
  // the watermark, the same WorldEvent row would be reclassified and
  // reapplied as fresh drift every single time.
  it('#276: does not reapply drift when invoked twice with the same turnNumber', async () => {
    const campaign = await prisma.campaign.create({
      data: { title: 'NPC Disposition Idempotency Test', aiSystemPrompt: 'test', initialWorldSeed: 'test' },
    })
    const idempCampaignId = campaign.id
    await prisma.worldMeta.create({ data: { campaignId: idempCampaignId, currentTurnNumber: 2 } })

    const npc = await prisma.nPC.create({
      data: { campaignId: idempCampaignId, name: 'Idle Lieutenant', importance: 5, isAlive: true },
    })
    await prisma.worldEvent.create({
      data: {
        campaignId: idempCampaignId,
        turnNumber: 1,
        type: 'npc.consequence',
        origin: 'consequence',
        targetType: 'NPC',
        targetId: npc.id,
        targetName: 'Idle Lieutenant',
        field: 'consequence',
        previousValue: '(none)',
        newValue: 'THREATENED',
        reason: 'The party threatened the lieutenant',
        significant: true,
        importance: 'NORMAL',
      },
    })

    const ctx: TickContext = {
      campaignId: idempCampaignId, turnNumber: 2, factionCap: 10, npcCap: 20, dryRun: false, db: prisma as any,
    }
    const first = await tickNpcDisposition(ctx)
    expect(first.changes).toHaveLength(1)

    // Same turnNumber again — simulating the daily cron sweep re-ticking a
    // genuinely idle campaign.
    const second = await tickNpcDisposition(ctx)
    expect(second.changes).toEqual([])

    const npcAfter = await prisma.nPC.findUnique({ where: { id: npc.id }, select: { disposition: true } })
    expect(npcAfter?.disposition).toMatchObject({ selfPreservation: 54 })

    await prisma.campaign.delete({ where: { id: idempCampaignId } }).catch(() => {})
  })

  // #283: the per-tick NPC cap ordered by importance desc alone — among
  // NPCs tied at the same importance, the same subset (DB scan order) won
  // the cap every single tick forever. npcDispositionTick.ts now appends
  // the shared capOrdering.ts rotation key as a tiebreaker, so equally-
  // important NPCs rotate through instead.
  it('#283: rotates equally-important NPCs through the cap across consecutive ticks', async () => {
    const campaign = await prisma.campaign.create({
      data: { title: 'NPC Cap Rotation Live Test', aiSystemPrompt: 'test', initialWorldSeed: 'test' },
    })
    const rotationCampaignId = campaign.id
    await prisma.worldMeta.create({ data: { campaignId: rotationCampaignId, currentTurnNumber: 2 } })

    // 12 NPCs, all tied at the same major importance, against a cap of 5.
    const npcIds: string[] = []
    for (let i = 0; i < 12; i++) {
      const n = await prisma.nPC.create({
        data: { campaignId: rotationCampaignId, name: `Lieutenant ${i}`, importance: 5, isAlive: true },
      })
      npcIds.push(n.id)
    }

    const selectedEachTick: string[][] = []
    for (let turn = 2; turn <= 4; turn++) {
      const ctx: TickContext = {
        campaignId: rotationCampaignId, turnNumber: turn, factionCap: 10, npcCap: 5, dryRun: false, db: prisma as any,
      }
      await tickNpcDisposition(ctx)

      const rows = await prisma.nPC.findMany({
        where: { campaignId: rotationCampaignId, lastTickedAt: { not: null } },
        select: { id: true },
      })
      const tickedSoFar = new Set(rows.map((r) => r.id))
      const newlyTicked = npcIds.filter((id) => tickedSoFar.has(id) && !selectedEachTick.flat().includes(id))
      selectedEachTick.push(newlyTicked)
    }

    expect(new Set(selectedEachTick[0])).not.toEqual(new Set(selectedEachTick[1]))
    const everTicked = new Set(selectedEachTick.flat())
    expect(everTicked.size).toBe(12)

    await prisma.campaign.delete({ where: { id: rotationCampaignId } }).catch(() => {})
  })
})
