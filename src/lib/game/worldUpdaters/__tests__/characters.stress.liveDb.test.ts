// src/lib/game/worldUpdaters/__tests__/characters.stress.liveDb.test.ts
//
// Real-database verification for the stress system's first-ever
// production write path: a real Character row, a real
// applyCharacterChanges() call inside a real transaction, a real
// Character.stress UPDATE — and the live DB CHECK constraint
// (Character_stress_range) actually clamping correctly rather than just
// trusting decideStressDrift's own in-app clamp.
//
// Opt-in, matching this repo's own convention (see logisticsTick.liveDb.test.ts,
// npcDispositionTick.liveDb.test.ts):
//
//   RUN_DB_TESTS=1 npx vitest run characters.stress.liveDb

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { applyCharacterChanges, PcChange } from '../characters'

const RUN = process.env.RUN_DB_TESTS === '1'
const describeIfDb = RUN ? describe : describe.skip

describeIfDb('applyCharacterChanges — stress, real database', () => {
  const prisma = new PrismaClient()
  let campaignId: string
  let userId: string
  let characterId: string

  beforeAll(async () => {
    const campaign = await prisma.campaign.create({
      data: { title: 'Stress Live Test', aiSystemPrompt: 'test', initialWorldSeed: 'test' },
    })
    campaignId = campaign.id

    const user = await prisma.user.create({
      data: { email: `stress-live-${Date.now()}@example.com`, name: 'Stress Tester' },
    })
    userId = user.id

    const character = await prisma.character.create({
      data: { campaignId, userId, name: 'Kess', stats: { cool: 0, hard: 0, hot: 0, sharp: 0, weird: 2 } },
    })
    characterId = character.id
  })

  afterAll(async () => {
    await prisma.campaign.delete({ where: { id: campaignId } }).catch(() => {})
    await prisma.user.delete({ where: { id: userId } }).catch(() => {})
    await prisma.$disconnect()
  })

  it('raises stress on a real miss and persists it to a real row', async () => {
    const before = await prisma.character.findUnique({ where: { id: characterId }, select: { stress: true } })
    expect(before?.stress).toBe(0)

    await prisma.$transaction(async (tx) => {
      const roster = await tx.character.findMany({ where: { campaignId } })
      await applyCharacterChanges(
        tx, campaignId, 1,
        [{ character_name_or_id: 'Kess', changes: {} } as PcChange],
        roster, [],
        async () => null,
        true,
        [{ characterId, characterName: 'Kess', outcome: 'miss' } as any]
      )
    })

    const after = await prisma.character.findUnique({ where: { id: characterId }, select: { stress: true } })
    expect(after?.stress).toBe(1)
  })

  it('recovers on a quiet exchange, writing a real decayed value', async () => {
    await prisma.$transaction(async (tx) => {
      const roster = await tx.character.findMany({ where: { campaignId } })
      await applyCharacterChanges(
        tx, campaignId, 2,
        [{ character_name_or_id: 'Kess', changes: { location: 'The Docks' } } as PcChange],
        roster, [],
        async () => null,
        true
      )
    })

    const after = await prisma.character.findUnique({ where: { id: characterId }, select: { stress: true } })
    expect(after?.stress).toBe(0)
  })

  it('the live CHECK constraint holds the floor/ceiling even if application code tried to violate it', async () => {
    await expect(
      prisma.character.update({ where: { id: characterId }, data: { stress: 11 } })
    ).rejects.toThrow()
    await expect(
      prisma.character.update({ where: { id: characterId }, data: { stress: -1 } })
    ).rejects.toThrow()

    const after = await prisma.character.findUnique({ where: { id: characterId }, select: { stress: true } })
    expect(after?.stress).toBe(0) // unchanged — both writes were rejected
  })
})
