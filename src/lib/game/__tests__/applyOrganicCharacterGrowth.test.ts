// src/lib/game/__tests__/applyOrganicCharacterGrowth.test.ts
// #214: applyOrganicCharacterGrowth (sceneResolver.ts) reads a character
// snapshot, computes stat/perk/move growth off it, then writes the whole
// result back OUTSIDE the pc_changes transaction with no lock. Two
// overlapping scene resolutions for the same character could both read the
// same stale advancementLog, both see arc budget available, and the second
// blind write would clobber the first. These tests pin the fix: the write
// now goes through updateMany guarded on (id, advancementVersion), so only
// the transaction that still finds the version it read actually applies.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  sceneFindUnique: vi.fn(),
  worldMetaFindUnique: vi.fn(),
  characterUpdateMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    scene: { findUnique: mocks.sceneFindUnique },
    worldMeta: { findUnique: mocks.worldMetaFindUnique },
    character: { updateMany: mocks.characterUpdateMany },
  },
}))

import { applyOrganicCharacterGrowth } from '../sceneResolver'

function makeCharacter(overrides: Record<string, any> = {}) {
  return {
    id: 'char1',
    name: 'Jason',
    statUsage: {},
    stats: { hard: 1 },
    perks: [],
    moves: [],
    advancementLog: null,
    advancementVersion: 3,
    ...overrides,
  }
}

function makeScene(character: any) {
  return {
    id: 'scene1',
    campaignId: 'camp1',
    playerActions: [
      { id: 'action1', characterId: 'char1', status: 'pending', rollResult: null, character },
    ],
  }
}

function aiResponseGranting(perkName = 'Iron Will') {
  return {
    world_updates: {
      organic_advancement: [
        {
          character_id: 'char1',
          new_perks: [{ name: perkName, description: 'Never breaks under pressure.' }],
        },
      ],
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.worldMetaFindUnique.mockResolvedValue({ currentTurnNumber: 5 })
  mocks.characterUpdateMany.mockResolvedValue({ count: 1 })
})

describe('applyOrganicCharacterGrowth (#214)', () => {
  it('guards the growth write on the exact advancementVersion just read, with an atomic increment', async () => {
    const character = makeCharacter({ advancementVersion: 7 })
    mocks.sceneFindUnique.mockResolvedValue(makeScene(character))

    await applyOrganicCharacterGrowth('camp1', 'scene1', aiResponseGranting())

    expect(mocks.characterUpdateMany).toHaveBeenCalledWith({
      where: { id: 'char1', advancementVersion: 7 },
      data: expect.objectContaining({
        perks: expect.arrayContaining([expect.objectContaining({ name: 'Iron Will' })]),
        advancementVersion: { increment: 1 },
      }),
    })
  })

  it('does not lose a grant silently when a racing resolution already wrote first (count: 0)', async () => {
    const character = makeCharacter()
    mocks.sceneFindUnique.mockResolvedValue(makeScene(character))
    mocks.characterUpdateMany.mockResolvedValueOnce({ count: 0 })

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await applyOrganicCharacterGrowth('camp1', 'scene1', aiResponseGranting())

    // The race is detected and logged, not silently swallowed.
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('advancement state changed underneath this write'))
    warnSpy.mockRestore()
  })

  it('applies growth normally when the guarded write actually wins the race', async () => {
    const character = makeCharacter()
    mocks.sceneFindUnique.mockResolvedValue(makeScene(character))
    mocks.characterUpdateMany.mockResolvedValueOnce({ count: 1 })

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await applyOrganicCharacterGrowth('camp1', 'scene1', aiResponseGranting())

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Applied growth to Jason'))
    logSpy.mockRestore()
  })

  it('guards the stat-usage-only write (no growth this exchange) the same way', async () => {
    const character = makeCharacter()
    mocks.sceneFindUnique.mockResolvedValue(makeScene(character))
    // No organic_advancement for this character and no system-computed
    // growth (empty statUsage) — falls into the stat-usage-only branch.
    await applyOrganicCharacterGrowth('camp1', 'scene1', { world_updates: {} })

    expect(mocks.characterUpdateMany).toHaveBeenCalledWith({
      where: { id: 'char1', advancementVersion: 3 },
      data: expect.objectContaining({ advancementVersion: { increment: 1 } }),
    })
  })

  it('does two racing calls never both grant the same perk against the same starting version', async () => {
    // Simulates the exact bug: two calls both read advancementVersion: 3.
    // The first call's updateMany succeeds (count: 1); by the time the
    // second call's updateMany runs, the real DB row would have moved to
    // version 4, so a real Postgres WHERE advancementVersion = 3 would
    // affect 0 rows — modeled here by the second mocked call returning 0.
    const character = makeCharacter({ advancementVersion: 3 })
    mocks.sceneFindUnique.mockResolvedValue(makeScene(character))
    mocks.characterUpdateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })

    await applyOrganicCharacterGrowth('camp1', 'scene1', aiResponseGranting())
    await applyOrganicCharacterGrowth('camp1', 'scene1', aiResponseGranting())

    expect(mocks.characterUpdateMany).toHaveBeenCalledTimes(2)
    // Both calls used the SAME guard value (both read version 3 from the
    // same stale snapshot) — this is what the real DB's WHERE clause
    // relies on to let only one of them actually win.
    expect(mocks.characterUpdateMany.mock.calls[0][0].where).toEqual({ id: 'char1', advancementVersion: 3 })
    expect(mocks.characterUpdateMany.mock.calls[1][0].where).toEqual({ id: 'char1', advancementVersion: 3 })
  })
})
