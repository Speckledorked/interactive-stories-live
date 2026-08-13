// src/lib/game/tick/__tests__/migrationTick.liveDb.test.ts
//
// #262: PopulationFlightEvent is this codebase's FIRST write to that table
// — every other migrationTick test mocks Prisma, which never forces the
// createMany call, the FK constraint, or the real row shape to surface.
// Exercises tickMigration against real Postgres end to end: a real
// distressed/viable Location pair, a real population shift, and a real
// PopulationFlightEvent row recording where it came from.
//
// Opt-in, matching the repo's other *.liveDb.test.ts files:
//
//   RUN_DB_TESTS=1 npx vitest run migrationTick.liveDb

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { tickMigration } from '../migrationTick'
import type { TickContext } from '../types'

const RUN = process.env.RUN_DB_TESTS === '1'
const describeIfDb = RUN ? describe : describe.skip

describeIfDb('tickMigration — real database (#262)', () => {
  const prisma = new PrismaClient()
  let campaignId: string
  let ruinsId: string
  let capitalId: string

  beforeAll(async () => {
    const campaign = await prisma.campaign.create({
      data: { title: 'Migration Live Test', aiSystemPrompt: 'test', initialWorldSeed: 'test' },
    })
    campaignId = campaign.id

    const ruins = await prisma.location.create({
      data: { campaignId, name: 'The Ruins', conditionScore: 10, population: 100, isDiscovered: true },
    })
    ruinsId = ruins.id

    const capital = await prisma.location.create({
      data: { campaignId, name: 'The Capital', conditionScore: 90, population: 500, isDiscovered: true },
    })
    capitalId = capital.id
  })

  afterAll(async () => {
    await prisma.campaign.delete({ where: { id: campaignId } }).catch(() => {})
    await prisma.$disconnect()
  })

  it('writes a real PopulationFlightEvent row naming the source and destination', async () => {
    expect(await prisma.populationFlightEvent.count({ where: { campaignId } })).toBe(0)

    const ctx: TickContext = {
      campaignId, turnNumber: 3, factionCap: 10, npcCap: 20, dryRun: false, db: prisma as any,
    }
    await tickMigration(ctx)

    const events = await prisma.populationFlightEvent.findMany({ where: { campaignId } })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      campaignId,
      turnNumber: 3,
      fromLocationId: ruinsId,
      fromLocationName: 'The Ruins',
      toLocationId: capitalId,
      toLocationName: 'The Capital',
      count: 10,
    })

    const ruins = await prisma.location.findUnique({ where: { id: ruinsId }, select: { population: true } })
    expect(ruins?.population).toBe(90)
  })
})
