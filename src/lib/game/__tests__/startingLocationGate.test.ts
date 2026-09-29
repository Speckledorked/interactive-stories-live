// src/lib/game/__tests__/startingLocationGate.test.ts
//
// #479: corruption gates apply at boundaries, and creation is a boundary
// nobody was checking.
//
// corruptionGates.ts's header names three — location ENTRY, quest
// ACQUISITION, NPC LEVERAGE — and lists "the shrine that only opens to the
// marked" as the worked example of what a gate is for. createCharacter
// placed a character at body.currentLocation with no gate check anywhere in
// its path, so that shrine could be reached by starting inside it. Movement
// was gated; arrival was not.
//
// A new character has corruption 0, so this enforces minCorruption in
// practice. The check still asks checkCorruptionGate rather than testing
// minCorruption itself — re-deriving "which half can fire here" at the call
// site is how one rule becomes two.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaignCapability: { findMany: vi.fn() },
    campaign: { findUnique: vi.fn() },
    character: { create: vi.fn() },
    characterCapability: { createMany: vi.fn() },
    debt: { create: vi.fn() },
    campaignArchetype: { findFirst: vi.fn() },
    location: { findUnique: vi.fn() },
  },
}))
vi.mock('@/lib/wiki/contactNpcStubs', () => ({ ensureContactNpcStubs: vi.fn() }))
vi.mock('@/lib/game/worldUpdaters/locations', () => ({
  resolveOrCreateLocationId: vi.fn().mockResolvedValue('loc1'),
}))

import { prisma } from '@/lib/prisma'
import { resolveOrCreateLocationId } from '@/lib/game/worldUpdaters/locations'
import { createCharacter, StartingLocationError } from '../characterCreation'

const db = prisma as any

const THEME = {
  name: 'the Rot',
  description: 'It takes, and leaves something behind.',
  stages: [{ threshold: 1, label: 'Touched', description: 'x' }],
}

/** Campaign.findUnique is called for advancementTrack AND corruptionTheme. */
function arrangeCampaign(corruptionTheme: unknown) {
  db.campaign.findUnique.mockResolvedValue({ advancementTrack: null, corruptionTheme })
  db.character.create.mockResolvedValue({ id: 'char1' })
  db.campaignCapability.findMany.mockResolvedValue([])
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(resolveOrCreateLocationId as any).mockResolvedValue('loc1')
})

describe('starting-location corruption gate (#479)', () => {
  it('refuses a starting location that only opens to the marked', async () => {
    arrangeCampaign(THEME)
    db.location.findUnique.mockResolvedValue({ minCorruption: 2, maxCorruption: null })

    await expect(
      createCharacter('camp1', 'user1', { name: 'Jason', currentLocation: 'The Sunken Shrine' })
    ).rejects.toBeInstanceOf(StartingLocationError)
  })

  it('refuses BEFORE creating the location row or the character', async () => {
    // resolveOrCreateLocationId creates the row when it is missing, so a
    // check placed after it would leave a Location behind from a creation
    // that was refused.
    arrangeCampaign(THEME)
    db.location.findUnique.mockResolvedValue({ minCorruption: 2, maxCorruption: null })

    await expect(
      createCharacter('camp1', 'user1', { name: 'Jason', currentLocation: 'The Sunken Shrine' })
    ).rejects.toThrow()

    expect(resolveOrCreateLocationId).not.toHaveBeenCalled()
    expect(db.character.create).not.toHaveBeenCalled()
  })

  it('names the location and speaks in the theme’s own language, never numbers', async () => {
    // describeRefusal's discipline: the player is told a door did not open
    // to them, not that they hold fewer than two of something.
    arrangeCampaign(THEME)
    db.location.findUnique.mockResolvedValue({ minCorruption: 2, maxCorruption: null })

    let message = ''
    try {
      await createCharacter('camp1', 'user1', { name: 'Jason', currentLocation: 'The Sunken Shrine' })
    } catch (error) {
      message = (error as Error).message
    }

    expect(message).toContain('The Sunken Shrine')
    expect(message).toContain('the Rot')
    expect(message).not.toMatch(/\d/)
    expect(message.toLowerCase()).not.toContain('corruption')
  })

  it('allows an ungated location', async () => {
    arrangeCampaign(THEME)
    db.location.findUnique.mockResolvedValue({ minCorruption: null, maxCorruption: null })

    await createCharacter('camp1', 'user1', { name: 'Jason', currentLocation: 'The Docks' })
    expect(db.character.create).toHaveBeenCalled()
  })

  it('allows a maxCorruption gate, which a fresh character always passes', async () => {
    arrangeCampaign(THEME)
    db.location.findUnique.mockResolvedValue({ minCorruption: null, maxCorruption: 1 })

    await createCharacter('camp1', 'user1', { name: 'Jason', currentLocation: 'The Chapel' })
    expect(db.character.create).toHaveBeenCalled()
  })

  it('does not gate a campaign with no corruption theme, gate or not', async () => {
    // A gate left on a row in a re-themed or imported campaign must not
    // silently lock content — the same rule checkCorruptionGate applies.
    arrangeCampaign(null)
    db.location.findUnique.mockResolvedValue({ minCorruption: 5, maxCorruption: null })

    await createCharacter('camp1', 'user1', { name: 'Jason', currentLocation: 'The Sunken Shrine' })
    expect(db.character.create).toHaveBeenCalled()
  })

  it('does not gate a location the player is naming into existence', async () => {
    arrangeCampaign(THEME)
    db.location.findUnique.mockResolvedValue(null)

    await createCharacter('camp1', 'user1', { name: 'Jason', currentLocation: 'Somewhere New' })
    expect(db.character.create).toHaveBeenCalled()
  })

  it('fails OPEN when the lookup itself errors', async () => {
    // A gate that wrongly refuses stops someone making a character at all;
    // one that wrongly permits costs a moment of flavour.
    arrangeCampaign(THEME)
    db.location.findUnique.mockRejectedValue(new Error('db down'))

    await createCharacter('camp1', 'user1', { name: 'Jason', currentLocation: 'The Sunken Shrine' })
    expect(db.character.create).toHaveBeenCalled()
  })

  it('skips the check entirely when no location was given', async () => {
    arrangeCampaign(THEME)
    await createCharacter('camp1', 'user1', { name: 'Jason' })
    expect(db.location.findUnique).not.toHaveBeenCalled()
    expect(db.character.create).toHaveBeenCalled()
  })
})
