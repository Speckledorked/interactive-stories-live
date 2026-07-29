// src/lib/game/tick/__tests__/warTick.faultInjection.test.ts
//
// Real-database fault injection for the Phase 0 War.contestedLocationId
// bug — every OTHER warTick test mocks Prisma and always returns a
// Location for `findUnique`, which is exactly why the original bug was
// invisible to the suite: nobody had to write the "the row is actually
// gone" case, because a mock never forces you to. This file replaces the
// mock with a real Postgres connection so the deletion, the constraint,
// and the tick handler are all exercised for real.
//
// Opt-in, deliberately: this repo's CI runs `npx vitest run` with no
// database at all (see .github/workflows/ci.yml — "Tests are fully
// mocked (no database needed)"), so this file no-ops unless RUN_DB_TESTS
// is set and DATABASE_URL points at something real.
//
//   RUN_DB_TESTS=1 npx vitest run warTick.faultInjection

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'

const RUN = process.env.RUN_DB_TESTS === '1'
const describeIfDb = RUN ? describe : describe.skip

describeIfDb('War.contestedLocationId — real database fault injection', () => {
  const prisma = new PrismaClient()
  let campaignId: string
  let locationId: string
  let attackerFactionId: string
  let defenderFactionId: string

  beforeAll(async () => {
    const campaign = await prisma.campaign.create({
      data: {
        title: 'Fault Injection Test Campaign',
        aiSystemPrompt: 'test',
        initialWorldSeed: 'test',
      },
    })
    campaignId = campaign.id

    const location = await prisma.location.create({
      data: { campaignId, name: 'The Disputed Keep' },
    })
    locationId = location.id

    const attacker = await prisma.faction.create({
      data: { campaignId, name: 'The Ashcrown Court', isActive: true, military: 90 },
    })
    attackerFactionId = attacker.id

    const defender = await prisma.faction.create({
      data: { campaignId, name: 'The Collapsed Remnant', isActive: false, military: 5 },
    })
    defenderFactionId = defender.id
  })

  afterAll(async () => {
    // Cascade from Campaign takes everything else with it.
    await prisma.campaign.delete({ where: { id: campaignId } }).catch(() => {})
    await prisma.$disconnect()
  })

  it('the FK makes the dangling-reference state impossible to create at all', async () => {
    // This is the strongest form of the Phase 1b claim: not "the code
    // survives it" but "the database will not let it happen" — a direct
    // insert with a bogus contestedLocationId is rejected before any tick
    // code ever runs.
    await expect(
      prisma.war.create({
        data: {
          campaignId,
          name: 'Should Never Exist',
          attackerFactionId,
          defenderFactionId,
          contestedLocationId: 'this-location-id-does-not-exist',
          startedTurn: 1,
        },
      })
    ).rejects.toThrow()
  })

  it('deleting the contested Location sets contestedLocationId to null via the real FK, and tickWars survives it', async () => {
    const war = await prisma.war.create({
      data: {
        campaignId,
        name: 'The Siege of the Disputed Keep',
        attackerFactionId,
        defenderFactionId,
        contestedLocationId: locationId,
        startedTurn: 1,
        momentum: 0,
      },
    })
    await prisma.warParticipant.create({ data: { warId: war.id, factionId: attackerFactionId, side: 'ATTACKER', joinedTurn: 1 } })
    await prisma.warParticipant.create({ data: { warId: war.id, factionId: defenderFactionId, side: 'DEFENDER', joinedTurn: 1 } })

    // The real fault: delete the row a live War is contesting, out from
    // under it — exactly what happened in production.
    await prisma.location.delete({ where: { id: locationId } })

    const afterDelete = await prisma.war.findUniqueOrThrow({ where: { id: war.id } })
    expect(afterDelete.contestedLocationId).toBeNull()

    const { tickWars } = await import('../warTick')
    const result = await tickWars({
      campaignId, turnNumber: 2, factionCap: 10, npcCap: 20, dryRun: false, db: prisma,
    })

    const resolved = await prisma.war.findUniqueOrThrow({ where: { id: war.id } })
    expect(resolved.status).toBe('RESOLVED')
    expect(result.changes.some((c) => c.field === 'warEnded')).toBe(true)
  })
})
