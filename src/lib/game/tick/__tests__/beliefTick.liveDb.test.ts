// src/lib/game/tick/__tests__/beliefTick.liveDb.test.ts
//
// Real-database verification for cultural drift / belief evolution (#104):
// the first-ever production execution of a real
// Faction.update({ data: { beliefVector } }) call, plus the #276
// watermark's idempotency guarantee against a real Postgres WorldMeta row.
//
// Opt-in, matching this directory's other *.liveDb.test.ts files:
//
//   RUN_DB_TESTS=1 npx vitest run beliefTick.liveDb

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { tickBeliefDrift } from '../beliefTick'
import type { TickContext } from '../types'

const RUN = process.env.RUN_DB_TESTS === '1'
const describeIfDb = RUN ? describe : describe.skip

describeIfDb('tickBeliefDrift — real database', () => {
  const prisma = new PrismaClient()
  let campaignId: string
  let factionId: string

  beforeAll(async () => {
    const campaign = await prisma.campaign.create({
      data: { title: 'Belief Drift Live Test', aiSystemPrompt: 'test', initialWorldSeed: 'test' },
    })
    campaignId = campaign.id

    const faction = await prisma.faction.create({
      data: { campaignId, name: 'Ashcrown Company', isActive: true },
    })
    factionId = faction.id
  })

  afterAll(async () => {
    await prisma.campaign.delete({ where: { id: campaignId } }).catch(() => {})
    await prisma.$disconnect()
  })

  it('drifts and persists a real belief vector from a real prior-turn WorldEvent', async () => {
    const factionBefore = await prisma.faction.findUnique({ where: { id: factionId }, select: { beliefVector: true } })
    expect(factionBefore?.beliefVector).toBeNull()

    await prisma.worldEvent.create({
      data: {
        campaignId,
        turnNumber: 1,
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
      campaignId, turnNumber: 2, factionCap: 10, npcCap: 20, dryRun: false, db: prisma as any,
    }
    const result = await tickBeliefDrift(ctx)

    expect(result.changes).toHaveLength(1)
    expect(result.changes[0]).toMatchObject({ entityType: 'FACTION', entityId: factionId, field: 'beliefVector' })

    const factionAfter = await prisma.faction.findUnique({ where: { id: factionId }, select: { beliefVector: true } })
    expect(factionAfter?.beliefVector).toMatchObject({ aggression: 54, isolationism: 46 })
  })

  // #276: this is the exact scenario the frozen-turnNumber bug produces —
  // an idle campaign's daily cron sweep invokes runWorldTick with the SAME
  // turnNumber on every pass, since nothing else ever advances it. Without
  // the watermark, the same WorldEvent row would be reclassified and
  // reapplied as fresh drift every single time.
  it('#276: does not reapply drift when invoked twice with the same turnNumber', async () => {
    const campaign = await prisma.campaign.create({
      data: { title: 'Belief Drift Idempotency Test', aiSystemPrompt: 'test', initialWorldSeed: 'test' },
    })
    const idempCampaignId = campaign.id
    await prisma.worldMeta.create({ data: { campaignId: idempCampaignId, currentTurnNumber: 2 } })

    const faction = await prisma.faction.create({
      data: { campaignId: idempCampaignId, name: 'Idle Company', isActive: true },
    })
    await prisma.worldEvent.create({
      data: {
        campaignId: idempCampaignId,
        turnNumber: 1,
        type: 'faction.warResolved',
        origin: 'tick',
        targetType: 'FACTION',
        targetId: faction.id,
        targetName: 'Idle Company',
        field: 'warResolved',
        previousValue: null,
        newValue: 'attacker',
        reason: 'Idle Company wins the war',
        significant: true,
        importance: 'MAJOR',
      },
    })

    const ctx: TickContext = {
      campaignId: idempCampaignId, turnNumber: 2, factionCap: 10, npcCap: 20, dryRun: false, db: prisma as any,
    }
    const first = await tickBeliefDrift(ctx)
    expect(first.changes).toHaveLength(1)

    // Same turnNumber again — simulating the daily cron sweep re-ticking a
    // genuinely idle campaign.
    const second = await tickBeliefDrift(ctx)
    expect(second.changes).toEqual([])

    const factionAfter = await prisma.faction.findUnique({ where: { id: faction.id }, select: { beliefVector: true } })
    expect(factionAfter?.beliefVector).toMatchObject({ aggression: 54 })

    await prisma.campaign.delete({ where: { id: idempCampaignId } }).catch(() => {})
  })
})
