// src/lib/game/__tests__/startingLoadout.test.ts
//
// An established character may start with rank and capabilities — but only
// ones this world declares, within bounds this world states.
//
// Creation used to force every character onto the bottom rung, on the
// reasoning "a character being created has done nothing yet". That is only
// the DEFAULT: an Iron adventurer with essences already bound, or a Diamond,
// is a legitimate concept the wizard could not express — the player would
// start "Normal" with nothing and have to grind the fiction to claim a
// backstory they already wrote.
//
// The trust model is archetype selection's: the client picks among
// campaign-generated content; the server validates membership. Three bounds,
// none invented here:
//
//   - visibility: non-secret, non-shadow nodes only (the surface glimpse
//     seeding already exposes). Shadow arts gate on corruption >= tier IN
//     PLAY, and a fresh character has zero corruption — starting with one
//     would bypass a gate the engine enforces everywhere else;
//   - slot-group capacity: the generator declared how many essences this
//     world allows; a loadout cannot begin past what the fiction states;
//   - prerequisite closure: the #372 DAG holds at creation as it holds in
//     play. An established character earned the whole chain.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaignCapability: { findMany: vi.fn() },
    campaign: { findUnique: vi.fn() },
    character: { create: vi.fn() },
    characterCapability: { createMany: vi.fn() },
    debt: { create: vi.fn() },
    campaignArchetype: { findFirst: vi.fn() },
  },
}))
vi.mock('@/lib/wiki/contactNpcStubs', () => ({ ensureContactNpcStubs: vi.fn() }))
vi.mock('@/lib/game/worldUpdaters/locations', () => ({ resolveOrCreateLocationId: vi.fn().mockResolvedValue(null) }))

import { prisma } from '@/lib/prisma'
import { resolveStartingCapabilities, StartingLoadoutError, createCharacter } from '../characterCreation'
import { parseAdvancementTrack } from '../advancementTrack'
import { UNLOCK_STARTING_PROFICIENCY } from '@/lib/game/capabilities'

const db = prisma as any

const TRACK = parseAdvancementTrack({
  tiers: [
    { key: 'normal', label: 'Normal' },
    { key: 'iron', label: 'Iron' },
    { key: 'diamond', label: 'Diamond' },
  ],
  slotGroups: [{ key: 'essences', label: 'Essences', capacity: 2, domain: 'Essence Magic' }],
})

function node(id: string, domain = 'Essence Magic', prereqs: Array<{ id: string; name: string }> = []) {
  return {
    id,
    name: id,
    domain,
    prerequisites: prereqs.map((p) => ({ prerequisiteCapabilityId: p.id, prerequisite: { name: p.name } })),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('resolveStartingCapabilities', () => {
  it('returns nothing for an empty or absent selection', async () => {
    expect(await resolveStartingCapabilities('camp1', TRACK, undefined)).toEqual([])
    expect(await resolveStartingCapabilities('camp1', TRACK, [])).toEqual([])
    expect(db.campaignCapability.findMany).not.toHaveBeenCalled()
  })

  it('passes a valid loadout through', async () => {
    db.campaignCapability.findMany.mockResolvedValue([node('fire'), node('water')])
    const ids = await resolveStartingCapabilities('camp1', TRACK, ['fire', 'water'])
    expect(ids.sort()).toEqual(['fire', 'water'])
    // The query itself carries the visibility rule — campaign-scoped,
    // never secret, never shadow. Ineligible ids silently vanish here,
    // because refusing them by name would leak that they exist.
    expect(db.campaignCapability.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ campaignId: 'camp1', isSecret: false, isShadow: false }),
      })
    )
  })

  it('drops ineligible ids silently rather than refusing by name', async () => {
    // The DB filter already excluded the secret id; the survivor passes.
    db.campaignCapability.findMany.mockResolvedValue([node('fire')])
    const ids = await resolveStartingCapabilities('camp1', TRACK, ['fire', 'forbidden-art'])
    expect(ids).toEqual(['fire'])
  })

  it('refuses a loadout past a slot-group capacity, naming the group', async () => {
    db.campaignCapability.findMany.mockResolvedValue([node('a'), node('b'), node('c')])
    await expect(resolveStartingCapabilities('camp1', TRACK, ['a', 'b', 'c'])).rejects.toThrow(
      /3 starting capabilities in Essences, but this world allows 2/
    )
  })

  it('does not cap domains outside any slot group', async () => {
    db.campaignCapability.findMany.mockResolvedValue([
      node('s1', 'Swordplay'), node('s2', 'Swordplay'), node('s3', 'Swordplay'),
    ])
    const ids = await resolveStartingCapabilities('camp1', TRACK, ['s1', 's2', 's3'])
    expect(ids).toHaveLength(3)
  })

  it('refuses a capstone whose foundation is not in the selection', async () => {
    db.campaignCapability.findMany.mockResolvedValue([
      node('battle-alchemy', 'Swordplay', [{ id: 'alchemy', name: 'Alchemy' }]),
    ])
    await expect(resolveStartingCapabilities('camp1', TRACK, ['battle-alchemy'])).rejects.toThrow(
      /"battle-alchemy" builds on "Alchemy"/
    )
  })

  it('accepts the same capstone when its chain is included', async () => {
    db.campaignCapability.findMany.mockResolvedValue([
      node('alchemy', 'Swordplay'),
      node('battle-alchemy', 'Swordplay', [{ id: 'alchemy', name: 'Alchemy' }]),
    ])
    const ids = await resolveStartingCapabilities('camp1', TRACK, ['battle-alchemy', 'alchemy'])
    expect(ids.sort()).toEqual(['alchemy', 'battle-alchemy'])
  })

  it('errors are StartingLoadoutError, so the route can 400 them', async () => {
    db.campaignCapability.findMany.mockResolvedValue([node('a'), node('b'), node('c')])
    await expect(resolveStartingCapabilities('camp1', TRACK, ['a', 'b', 'c'])).rejects.toBeInstanceOf(
      StartingLoadoutError
    )
  })
})

describe('createCharacter with an established start', () => {
  function arrangeCampaign() {
    db.campaign.findUnique.mockResolvedValue({
      advancementTrack: {
        tiers: [
          { key: 'normal', label: 'Normal' },
          { key: 'iron', label: 'Iron' },
        ],
        slotGroups: [{ key: 'essences', label: 'Essences', capacity: 4, domain: 'Essence Magic' }],
      },
    })
    db.character.create.mockResolvedValue({ id: 'char1' })
    // familiarity scaffold query (glimpse seeding) — empty keeps that path quiet
    db.campaignCapability.findMany.mockResolvedValue([])
  }

  it('stores the claimed rung by its resolved KEY, whatever casing the body used', async () => {
    arrangeCampaign()
    await createCharacter('camp1', 'user1', { name: 'Jason', advancementTier: 'IRON' })
    expect(db.character.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ advancementTier: 'iron' }) })
    )
  })

  it('falls back to the bottom rung when the claim names no declared rung', async () => {
    // "Cosmic Overlord" is not on this ladder. Nothing arbitrary is stored;
    // the character starts where every unestablished character starts.
    arrangeCampaign()
    await createCharacter('camp1', 'user1', { name: 'Jason', advancementTier: 'Cosmic Overlord' })
    expect(db.character.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ advancementTier: 'normal' }) })
    )
  })

  it('stays null for a campaign with no ladder, claim or not', async () => {
    db.campaign.findUnique.mockResolvedValue({ advancementTrack: null })
    db.character.create.mockResolvedValue({ id: 'char1' })
    db.campaignCapability.findMany.mockResolvedValue([])
    await createCharacter('camp1', 'user1', { name: 'Jason', advancementTier: 'iron' })
    expect(db.character.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ advancementTier: null }) })
    )
  })

  it('seeds the loadout as UNLOCKED at the standard unlock proficiency, before glimpses', async () => {
    arrangeCampaign()
    // First findMany call = loadout validation; second = glimpse scaffold.
    db.campaignCapability.findMany
      .mockResolvedValueOnce([node('fire-essence'), node('water-essence')])
      .mockResolvedValue([])
    await createCharacter('camp1', 'user1', {
      name: 'Jason',
      advancementTier: 'iron',
      startingCapabilityIds: ['fire-essence', 'water-essence'],
    })
    const calls = db.characterCapability.createMany.mock.calls
    expect(calls.length).toBeGreaterThanOrEqual(1)
    const loadoutCall = calls[0][0]
    expect(loadoutCall.data).toHaveLength(2)
    for (const row of loadoutCall.data) {
      expect(row.state).toBe('UNLOCKED')
      // The same floor an in-play unlock grants — established, not
      // legendary; mastery grows in the story.
      expect(row.proficiency).toBe(UNLOCK_STARTING_PROFICIENCY)
      expect(row.unlockedAt).toBeInstanceOf(Date)
    }
  })

  it('refuses the whole creation BEFORE any row is written when the loadout is invalid', async () => {
    // A rejected loadout must not leave a half-made character behind.
    db.campaign.findUnique.mockResolvedValue({
      advancementTrack: {
        tiers: [{ key: 'normal', label: 'Normal' }, { key: 'iron', label: 'Iron' }],
        slotGroups: [{ key: 'essences', label: 'Essences', capacity: 1, domain: 'Essence Magic' }],
      },
    })
    db.campaignCapability.findMany.mockResolvedValueOnce([node('a'), node('b')])
    await expect(
      createCharacter('camp1', 'user1', { name: 'Jason', startingCapabilityIds: ['a', 'b'] })
    ).rejects.toBeInstanceOf(StartingLoadoutError)
    expect(db.character.create).not.toHaveBeenCalled()
  })
})
