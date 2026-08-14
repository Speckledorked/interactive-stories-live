// src/lib/game/tick/__tests__/worldEventLog.liveDb.test.ts
//
// #101: persistWorldEvents switched from createMany to createManyAndReturn
// specifically so callers can get real WorldEvent ids back — every other
// worldEventLog test mocks Prisma, which never forces createManyAndReturn's
// actual Postgres-specific behavior to surface. Also exercises EventWitness
// — this table's first-ever production write — against real constraints:
// the FKs, the @@unique([worldEventId, characterId]) constraint, and that
// skipDuplicates genuinely no-ops on a repeat insert rather than erroring.
//
// Opt-in, matching the repo's other *.liveDb.test.ts files:
//
//   RUN_DB_TESTS=1 npx vitest run worldEventLog.liveDb

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { persistWorldEvents } from '../worldEventLog'
import type { WorldChange } from '../types'

const RUN = process.env.RUN_DB_TESTS === '1'
const describeIfDb = RUN ? describe : describe.skip

describeIfDb('persistWorldEvents / EventWitness — real database (#101)', () => {
  const prisma = new PrismaClient()
  let campaignId: string
  let userId: string
  let characterId: string

  beforeAll(async () => {
    const campaign = await prisma.campaign.create({
      data: { title: 'Event Witness Live Test', aiSystemPrompt: 'test', initialWorldSeed: 'test' },
    })
    campaignId = campaign.id

    const user = await prisma.user.create({
      data: { email: `event-witness-live-${Date.now()}@example.com`, name: 'Witness Tester' },
    })
    userId = user.id

    const character = await prisma.character.create({
      data: { campaignId, userId, name: 'Kess' },
    })
    characterId = character.id
  })

  afterAll(async () => {
    await prisma.campaign.delete({ where: { id: campaignId } }).catch(() => {})
    await prisma.user.delete({ where: { id: userId } }).catch(() => {})
    await prisma.$disconnect()
  })

  function makeChange(overrides: Partial<WorldChange> = {}): WorldChange {
    return {
      entityType: 'FACTION',
      entityId: 'faction-1',
      entityName: 'The Rustwatch',
      campaignId,
      field: 'resources',
      previousValue: 50,
      newValue: 47,
      reason: 'test reason',
      significant: true,
      importance: 'NORMAL',
      ...overrides,
    }
  }

  it('returns real ids and significant flags from createManyAndReturn', async () => {
    const result = await persistWorldEvents(campaignId, 3, [
      makeChange({ significant: true }),
      makeChange({ significant: false }),
    ])

    expect(result.count).toBe(2)
    expect(result.events).toHaveLength(2)
    for (const event of result.events) {
      expect(typeof event.id).toBe('string')
      expect(event.id.length).toBeGreaterThan(0)
    }
    expect(result.events.filter((e) => e.significant)).toHaveLength(1)

    const rows = await prisma.worldEvent.findMany({ where: { campaignId, turnNumber: 3 } })
    expect(rows).toHaveLength(2)
  })

  it('writes a real WITNESSED EventWitness row, and skipDuplicates no-ops on a repeat insert', async () => {
    const { events } = await persistWorldEvents(campaignId, 4, [makeChange({ significant: true })])
    const worldEventId = events[0].id

    await prisma.eventWitness.createMany({
      data: [{ campaignId, worldEventId, characterId, grade: 'WITNESSED', turnNumber: 4 }],
      skipDuplicates: true,
    })

    const witnesses = await prisma.eventWitness.findMany({ where: { worldEventId } })
    expect(witnesses).toHaveLength(1)
    expect(witnesses[0]).toMatchObject({ campaignId, worldEventId, characterId, grade: 'WITNESSED', turnNumber: 4 })

    // Repeat insert (same worldEventId + characterId pair) — must not throw
    // and must not create a second row, proving the unique constraint +
    // skipDuplicates combination this whole design relies on actually holds.
    await prisma.eventWitness.createMany({
      data: [{ campaignId, worldEventId, characterId, grade: 'WITNESSED', turnNumber: 4 }],
      skipDuplicates: true,
    })
    expect(await prisma.eventWitness.count({ where: { worldEventId } })).toBe(1)
  })

  it('cascades on campaign deletion (real FK, not app-level cleanup)', async () => {
    const campaign = await prisma.campaign.create({
      data: { title: 'Cascade Test', aiSystemPrompt: 'test', initialWorldSeed: 'test' },
    })
    const user = await prisma.user.create({
      data: { email: `cascade-live-${Date.now()}@example.com`, name: 'Cascade Tester' },
    })
    const character = await prisma.character.create({
      data: { campaignId: campaign.id, userId: user.id, name: 'Doomed' },
    })

    const { events } = await persistWorldEvents(campaign.id, 1, [makeChange({ campaignId: campaign.id, significant: true })])
    await prisma.eventWitness.create({
      data: { campaignId: campaign.id, worldEventId: events[0].id, characterId: character.id, grade: 'WITNESSED', turnNumber: 1 },
    })
    expect(await prisma.eventWitness.count({ where: { campaignId: campaign.id } })).toBe(1)

    await prisma.campaign.delete({ where: { id: campaign.id } })
    expect(await prisma.eventWitness.count({ where: { campaignId: campaign.id } })).toBe(0)

    await prisma.user.delete({ where: { id: user.id } }).catch(() => {})
  })
})
