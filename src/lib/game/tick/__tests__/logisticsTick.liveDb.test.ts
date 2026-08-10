// src/lib/game/tick/__tests__/logisticsTick.liveDb.test.ts
//
// Real-database verification for the #106/#108 follow-up: SupplyRoute
// rows were never created anywhere in this codebase — no world-updater,
// no admin UI, no seed script ever called supplyRoute.create — so
// decideExtraction's gate could never fire in a real campaign, and every
// other logisticsTick test mocks Prisma, which never forces that gap to
// surface. This exercises the real supplyRoute.create() call (its FIRST
// ever production execution) against real Postgres: the FK constraints,
// the actual row shape, and that extraction really applies in the same
// tick a route is auto-created.
//
// Opt-in, deliberately, matching warTick.faultInjection.test.ts's own
// convention — this repo's CI runs fully mocked, no database needed:
//
//   RUN_DB_TESTS=1 npx vitest run logisticsTick.liveDb

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { tickLogistics } from '../logisticsTick'
import type { TickContext } from '../types'

const RUN = process.env.RUN_DB_TESTS === '1'
const describeIfDb = RUN ? describe : describe.skip

describeIfDb('tickLogistics — real database (#106/#108 follow-up)', () => {
  const prisma = new PrismaClient()
  let campaignId: string
  let factionId: string
  let resourceLocationId: string
  let hubLocationId: string

  beforeAll(async () => {
    const campaign = await prisma.campaign.create({
      data: { title: 'Logistics Live Test', aiSystemPrompt: 'test', initialWorldSeed: 'test' },
    })
    campaignId = campaign.id

    const faction = await prisma.faction.create({
      data: { campaignId, name: 'Ashcrown Company', isActive: true, resources: 50 },
    })
    factionId = faction.id

    const resourceLocation = await prisma.location.create({
      data: { campaignId, name: 'Ore Hills', ownerFactionId: factionId, resourceSlots: ['ore'] },
    })
    resourceLocationId = resourceLocation.id

    const hubLocation = await prisma.location.create({
      data: { campaignId, name: 'Ashcrown Hold', ownerFactionId: factionId },
    })
    hubLocationId = hubLocation.id
  })

  afterAll(async () => {
    await prisma.campaign.delete({ where: { id: campaignId } }).catch(() => {})
    await prisma.$disconnect()
  })

  it('creates a real SupplyRoute row and grants extraction in the same tick', async () => {
    expect(await prisma.supplyRoute.count({ where: { campaignId } })).toBe(0)

    const ctx: TickContext = {
      campaignId, turnNumber: 1, factionCap: 10, npcCap: 20, dryRun: false, db: prisma as any,
    }
    const result = await tickLogistics(ctx)

    const routes = await prisma.supplyRoute.findMany({ where: { campaignId } })
    expect(routes).toHaveLength(1)
    expect(routes[0]).toMatchObject({
      fromLocationId: resourceLocationId,
      toLocationId: hubLocationId,
      controllingFactionId: factionId,
      isBlockaded: false,
    })

    const faction = await prisma.faction.findUnique({ where: { id: factionId }, select: { resources: true } })
    expect(faction?.resources).toBe(52)
    expect(result.changes).toHaveLength(1)
  })

  it('does not create a second route once one already connects the faction\'s locations', async () => {
    const before = await prisma.supplyRoute.count({ where: { campaignId } })
    expect(before).toBe(1) // the route the previous test created

    const ctx: TickContext = {
      campaignId, turnNumber: 2, factionCap: 10, npcCap: 20, dryRun: false, db: prisma as any,
    }
    await tickLogistics(ctx)

    expect(await prisma.supplyRoute.count({ where: { campaignId } })).toBe(1)

    const faction = await prisma.faction.findUnique({ where: { id: factionId }, select: { resources: true } })
    expect(faction?.resources).toBe(54) // extracted again this turn
  })
})
