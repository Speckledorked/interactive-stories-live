// src/lib/game/__tests__/advancement.ts.test.ts
// Organic advancement: the stat-growth arc cooldown (without it, a stat
// that's crossed the growth threshold re-proposes +1 on every future
// resolution that uses it), and the perk/move-learning channels (both
// AI-authored — grounded in what this specific character actually did,
// not drawn from a fixed engine-side list — deduped by a server-derived id).

import { describe, it, expect } from 'vitest'
import {
  computeOrganicGrowth,
  applyOrganicGrowth,
  buildMoveFromAI,
  buildPerkFromAI,
  logMoveLearned,
  logStatIncrease,
  createAdvancementLog,
  formatAdvancementEntry,
  type StatUsage,
  type Move,
  type Perk,
} from '../advancement'
import { ARC_LENGTH_TURNS } from '../capabilities'

// Valid PbtA stat spread: sum = +2, at most one stat >= +2.
const baseStats = { cool: 0, hard: 0, hot: 0, sharp: 0, weird: 2 }

function makeCharacter(overrides: Partial<{ statUsage: StatUsage; perks: any; moves: any; stats: any }> = {}) {
  return {
    stats: baseStats,
    statUsage: {},
    perks: [],
    moves: [],
    ...overrides,
  } as any
}

const grownUsage: StatUsage = {
  cool: { uses: 12, successes: 8, failures: 4 }, // 66% success, crosses the 10-use/60% threshold
}

describe('computeOrganicGrowth — stat arc cooldown', () => {
  it('proposes a stat increase the first time the threshold is crossed', () => {
    const character = makeCharacter({ statUsage: grownUsage })
    const result = computeOrganicGrowth(character, 100)
    expect(result.statIncreases).toEqual([
      expect.objectContaining({ statKey: 'cool', delta: 1 }),
    ])
  })

  it('does not re-propose the same stat within ARC_LENGTH_TURNS of its last growth', () => {
    const character = makeCharacter({
      statUsage: { cool: { ...grownUsage.cool, lastGrowthTurn: 100 } },
    })
    const result = computeOrganicGrowth(character, 100 + ARC_LENGTH_TURNS - 1)
    expect(result.statIncreases).toEqual([])
  })

  it('proposes again once a full arc has passed since the last growth', () => {
    const character = makeCharacter({
      statUsage: { cool: { ...grownUsage.cool, lastGrowthTurn: 100 } },
    })
    const result = computeOrganicGrowth(character, 100 + ARC_LENGTH_TURNS)
    expect(result.statIncreases).toEqual([
      expect.objectContaining({ statKey: 'cool', delta: 1 }),
    ])
  })

  it('never proposes below the 10-use/60%-success threshold regardless of turn', () => {
    const character = makeCharacter({ statUsage: { cool: { uses: 5, successes: 5, failures: 0 } } })
    const result = computeOrganicGrowth(character, 9999)
    expect(result.statIncreases).toEqual([])
  })

  it('never proposes perks or moves — those are AI-authored only, not from a fixed engine-side list', () => {
    const character = makeCharacter({ statUsage: grownUsage })
    const result = computeOrganicGrowth(character, 100)
    expect(result.newPerks).toEqual([])
    expect(result.newMoves).toEqual([])
  })
})

describe('buildPerkFromAI', () => {
  it('derives a stable slug id from the name, independent of description', () => {
    const perk = buildPerkFromAI({
      name: 'Riposte',
      description: "You counter, you don't just block.",
      tags: ['combat'],
    })
    expect(perk.id).toBe('riposte')
    expect(perk.name).toBe('Riposte')
    expect(perk.tags).toEqual(['combat'])
  })

  it('the same name always derives the same id, even with different phrasing elsewhere', () => {
    const first = buildPerkFromAI({ name: 'Riposte', description: 'A' })
    const second = buildPerkFromAI({ name: 'Riposte', description: 'Reworded description entirely' })
    expect(first.id).toBe(second.id)
  })
})

describe('buildMoveFromAI', () => {
  it('derives a stable slug id from the name, independent of trigger/description', () => {
    const move = buildMoveFromAI({
      name: 'Read the Room',
      trigger: 'When you enter a tense negotiation',
      description: 'You always get one honest tell.',
    })
    expect(move.id).toBe('read-the-room')
    expect(move.name).toBe('Read the Room')
    expect(move.trigger).toBe('When you enter a tense negotiation')
  })

  it('the same name always derives the same id, even with different phrasing elsewhere', () => {
    const first = buildMoveFromAI({ name: 'Read the Room', trigger: 'A', description: 'B' })
    const second = buildMoveFromAI({ name: 'Read the Room', trigger: 'Different trigger text', description: 'Different description' })
    expect(first.id).toBe(second.id)
  })
})

describe('applyOrganicGrowth — moves', () => {
  it('grants a new move', () => {
    const character = makeCharacter()
    const move = buildMoveFromAI({ name: 'Read the Room', trigger: 'A', description: 'B' })
    const applied = applyOrganicGrowth(character, { statIncreases: [], newPerks: [], newMoves: [move] })
    expect(applied.updatedMoves).toEqual([move])
  })

  it('dedupes by id — reporting the same move again is a no-op', () => {
    const existing: Move = { id: 'read-the-room', name: 'Read the Room', trigger: 'A', description: 'B' }
    const character = makeCharacter({ moves: [existing] })
    const reReported = buildMoveFromAI({ name: 'Read the Room', trigger: 'Reworded trigger', description: 'Reworded description' })
    const applied = applyOrganicGrowth(character, { statIncreases: [], newPerks: [], newMoves: [reReported] })
    expect(applied.updatedMoves).toHaveLength(1)
    expect(applied.updatedMoves[0]).toEqual(existing)
  })
})

describe('applyOrganicGrowth — perks', () => {
  it('grants a new perk', () => {
    const character = makeCharacter()
    const perk = buildPerkFromAI({ name: 'Riposte', description: 'A' })
    const applied = applyOrganicGrowth(character, { statIncreases: [], newPerks: [perk], newMoves: [] })
    expect(applied.updatedPerks).toEqual([perk])
  })

  it('dedupes by id — reporting the same perk again is a no-op', () => {
    const existing: Perk = { id: 'riposte', name: 'Riposte', description: 'A' }
    const character = makeCharacter({ perks: [existing] })
    const reReported = buildPerkFromAI({ name: 'Riposte', description: 'Reworded description entirely' })
    const applied = applyOrganicGrowth(character, { statIncreases: [], newPerks: [reReported], newMoves: [] })
    expect(applied.updatedPerks).toHaveLength(1)
    expect(applied.updatedPerks[0]).toEqual(existing)
  })
})

describe('advancement log — move entries', () => {
  it('records both moveId and moveName', () => {
    const log = logMoveLearned(createAdvancementLog(), 'read-the-room', 'Read the Room', 'Demonstrated mastery', 5, 'scene-1')
    expect(log.totalMovesLearned).toBe(1)
    expect(log.entries[0].details).toMatchObject({ moveId: 'read-the-room', moveName: 'Read the Room' })
  })

  it('formats using moveName, falling back to moveId for entries logged before moveName existed', () => {
    const withName = logMoveLearned(createAdvancementLog(), 'read-the-room', 'Read the Room', 'reason', 5)
    expect(formatAdvancementEntry(withName.entries[0])).toContain('Read the Room')

    const legacyEntry = { ...withName.entries[0], details: { moveId: 'read-the-room', reason: 'reason' } }
    expect(formatAdvancementEntry(legacyEntry)).toContain('read-the-room')
  })
})

describe('advancement log — stat increase stamping', () => {
  it('records old/new values and reason', () => {
    const log = logStatIncrease(createAdvancementLog(), 'cool', 0, 1, 'Consistent successful use', 12, 'scene-1')
    expect(log.totalStatIncreases).toBe(1)
    expect(log.entries[0].details).toMatchObject({ statKey: 'cool', oldValue: 0, newValue: 1 })
  })
})
