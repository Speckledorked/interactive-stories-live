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
  countGrantsInArc,
  logMoveLearned,
  logStatIncrease,
  createAdvancementLog,
  formatAdvancementEntry,
  isEvolutionEligible,
  MAX_PERKS_PER_ARC,
  MAX_MOVES_PER_ARC,
  type StatUsage,
  type Move,
  type Perk,
} from '../advancement'
import { ARC_LENGTH_TURNS } from '../capabilities'
import { STRESS_EVOLUTION_THRESHOLD } from '../stress'

// Valid PbtA stat spread: sum = +2, at most one stat >= +2.
const baseStats = { cool: 0, hard: 0, hot: 0, sharp: 0, weird: 2 }

function makeCharacter(
  overrides: Partial<{ statUsage: StatUsage; perks: any; moves: any; stats: any; advancementLog: any }> = {}
) {
  return {
    stats: baseStats,
    statUsage: {},
    perks: [],
    moves: [],
    advancementLog: null,
    ...overrides,
  } as any
}

// A character whose advancement log already shows a grant of `type` at
// `turn` — i.e. one that has already spent its per-arc budget.
function logWithGrantAt(type: 'perk_gained' | 'move_learned', turn: number) {
  return {
    entries: [{ timestamp: new Date().toISOString(), turnNumber: turn, type, details: { reason: 'earlier' } }],
    totalStatIncreases: 0,
    totalPerksGained: type === 'perk_gained' ? 1 : 0,
    totalMovesLearned: type === 'move_learned' ? 1 : 0,
  }
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
    const applied = applyOrganicGrowth(character, { statIncreases: [], newPerks: [], newMoves: [move] }, 1)
    expect(applied.updatedMoves).toEqual([move])
    expect(applied.grantedMoves).toEqual([move])
  })

  it('dedupes by id — reporting the same move again is a no-op', () => {
    const existing: Move = { id: 'read-the-room', name: 'Read the Room', trigger: 'A', description: 'B' }
    const character = makeCharacter({ moves: [existing] })
    const reReported = buildMoveFromAI({ name: 'Read the Room', trigger: 'Reworded trigger', description: 'Reworded description' })
    const applied = applyOrganicGrowth(character, { statIncreases: [], newPerks: [], newMoves: [reReported] }, 1)
    expect(applied.updatedMoves).toHaveLength(1)
    expect(applied.updatedMoves[0]).toEqual(existing)
    // A duplicate must not be reported as granted — the caller logs off this.
    expect(applied.grantedMoves).toEqual([])
    expect(applied.skippedMoves).toEqual([{ move: reReported, reason: 'duplicate' }])
  })
})

describe('applyOrganicGrowth — perks', () => {
  it('grants a new perk', () => {
    const character = makeCharacter()
    const perk = buildPerkFromAI({ name: 'Riposte', description: 'A' })
    const applied = applyOrganicGrowth(character, { statIncreases: [], newPerks: [perk], newMoves: [] }, 1)
    expect(applied.updatedPerks).toEqual([perk])
    expect(applied.grantedPerks).toEqual([perk])
  })

  it('dedupes by id — reporting the same perk again is a no-op', () => {
    const existing: Perk = { id: 'riposte', name: 'Riposte', description: 'A' }
    const character = makeCharacter({ perks: [existing] })
    const reReported = buildPerkFromAI({ name: 'Riposte', description: 'Reworded description entirely' })
    const applied = applyOrganicGrowth(character, { statIncreases: [], newPerks: [reReported], newMoves: [] }, 1)
    expect(applied.updatedPerks).toHaveLength(1)
    expect(applied.updatedPerks[0]).toEqual(existing)
    expect(applied.grantedPerks).toEqual([])
    expect(applied.skippedPerks).toEqual([{ perk: reReported, reason: 'duplicate' }])
  })
})

describe('applyOrganicGrowth — per-arc grant budget', () => {
  it('grants only MAX_PERKS_PER_ARC when the AI reports a burst of distinct perks', () => {
    const character = makeCharacter()
    const proposed = ['Riposte', 'Iron Guard', 'Silver Tongue', 'Deadeye'].map(name =>
      buildPerkFromAI({ name, description: 'earned' })
    )
    const applied = applyOrganicGrowth(character, { statIncreases: [], newPerks: proposed, newMoves: [] }, 50)
    expect(applied.grantedPerks).toHaveLength(MAX_PERKS_PER_ARC)
    expect(applied.updatedPerks).toHaveLength(MAX_PERKS_PER_ARC)
    expect(applied.skippedPerks.every(s => s.reason === 'arc_budget')).toBe(true)
    expect(applied.skippedPerks).toHaveLength(proposed.length - MAX_PERKS_PER_ARC)
  })

  it('grants nothing when the budget was already spent earlier in the same arc', () => {
    const character = makeCharacter({ advancementLog: logWithGrantAt('perk_gained', 50) })
    const perk = buildPerkFromAI({ name: 'Riposte', description: 'earned' })
    const applied = applyOrganicGrowth(
      character,
      { statIncreases: [], newPerks: [perk], newMoves: [] },
      50 + ARC_LENGTH_TURNS - 1
    )
    expect(applied.grantedPerks).toEqual([])
    expect(applied.updatedPerks).toEqual([])
    expect(applied.skippedPerks).toEqual([{ perk, reason: 'arc_budget' }])
  })

  it('grants again once a full arc has passed since the last grant', () => {
    const character = makeCharacter({ advancementLog: logWithGrantAt('perk_gained', 50) })
    const perk = buildPerkFromAI({ name: 'Riposte', description: 'earned' })
    const applied = applyOrganicGrowth(
      character,
      { statIncreases: [], newPerks: [perk], newMoves: [] },
      50 + ARC_LENGTH_TURNS
    )
    expect(applied.grantedPerks).toEqual([perk])
  })

  it('budgets perks and abilities independently', () => {
    const character = makeCharacter({ advancementLog: logWithGrantAt('perk_gained', 50) })
    const perk = buildPerkFromAI({ name: 'Riposte', description: 'earned' })
    const move = buildMoveFromAI({ name: 'Read the Room', trigger: 'A', description: 'B' })
    const applied = applyOrganicGrowth(
      character,
      { statIncreases: [], newPerks: [perk], newMoves: [move] },
      51
    )
    // Perk budget spent, ability budget untouched.
    expect(applied.grantedPerks).toEqual([])
    expect(applied.grantedMoves).toEqual([move])
  })

  it('does not count a legacy log entry with no turnNumber against the budget', () => {
    const character = makeCharacter({
      advancementLog: {
        entries: [{ timestamp: new Date().toISOString(), type: 'perk_gained', details: { reason: 'legacy' } }],
        totalStatIncreases: 0,
        totalPerksGained: 1,
        totalMovesLearned: 0,
      },
    })
    const perk = buildPerkFromAI({ name: 'Riposte', description: 'earned' })
    const applied = applyOrganicGrowth(character, { statIncreases: [], newPerks: [perk], newMoves: [] }, 5)
    expect(applied.grantedPerks).toEqual([perk])
  })

  it('countGrantsInArc only counts the matching type inside the window', () => {
    const log = {
      entries: [
        { timestamp: '', turnNumber: 10, type: 'perk_gained' as const, details: { reason: '' } },
        { timestamp: '', turnNumber: 12, type: 'move_learned' as const, details: { reason: '' } },
        { timestamp: '', turnNumber: 1, type: 'perk_gained' as const, details: { reason: '' } }, // outside window
      ],
      totalStatIncreases: 0,
      totalPerksGained: 2,
      totalMovesLearned: 1,
    }
    expect(countGrantsInArc(log, 'perk_gained', 15)).toBe(1)
    expect(countGrantsInArc(log, 'move_learned', 15)).toBe(1)
    expect(countGrantsInArc(null, 'perk_gained', 15)).toBe(0)
  })
})

describe('isEvolutionEligible', () => {
  const emptyLog = { entries: [], totalStatIncreases: 0, totalPerksGained: 0, totalMovesLearned: 0 }

  it('is false below the stress threshold, even with full budget', () => {
    expect(isEvolutionEligible(STRESS_EVOLUTION_THRESHOLD - 1, emptyLog, 15)).toBe(false)
  })

  it('is true at or above the threshold with budget available', () => {
    expect(isEvolutionEligible(STRESS_EVOLUTION_THRESHOLD, emptyLog, 15)).toBe(true)
  })

  it('is true with a null/undefined log (nothing granted yet, budget is untouched)', () => {
    expect(isEvolutionEligible(STRESS_EVOLUTION_THRESHOLD, null, 15)).toBe(true)
    expect(isEvolutionEligible(STRESS_EVOLUTION_THRESHOLD, undefined, 15)).toBe(true)
  })

  it('is false once BOTH perk and move budgets are exhausted this arc', () => {
    const log = {
      entries: [
        { timestamp: '', turnNumber: 10, type: 'perk_gained' as const, details: { reason: '' } },
        { timestamp: '', turnNumber: 10, type: 'move_learned' as const, details: { reason: '' } },
      ],
      totalStatIncreases: 0,
      totalPerksGained: 1,
      totalMovesLearned: 1,
    }
    expect(MAX_PERKS_PER_ARC).toBe(1)
    expect(MAX_MOVES_PER_ARC).toBe(1)
    expect(isEvolutionEligible(STRESS_EVOLUTION_THRESHOLD, log, 15)).toBe(false)
  })

  it('is still true when only ONE of the two channels is exhausted', () => {
    const log = {
      entries: [{ timestamp: '', turnNumber: 10, type: 'perk_gained' as const, details: { reason: '' } }],
      totalStatIncreases: 0,
      totalPerksGained: 1,
      totalMovesLearned: 0,
    }
    expect(isEvolutionEligible(STRESS_EVOLUTION_THRESHOLD, log, 15)).toBe(true)
  })

  it('a grant outside the current arc window no longer blocks eligibility', () => {
    const log = {
      entries: [
        { timestamp: '', turnNumber: 1, type: 'perk_gained' as const, details: { reason: '' } },
        { timestamp: '', turnNumber: 1, type: 'move_learned' as const, details: { reason: '' } },
      ],
      totalStatIncreases: 0,
      totalPerksGained: 1,
      totalMovesLearned: 1,
    }
    expect(isEvolutionEligible(STRESS_EVOLUTION_THRESHOLD, log, 1 + ARC_LENGTH_TURNS)).toBe(true)
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
