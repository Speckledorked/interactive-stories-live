// src/lib/game/__tests__/resolution.test.ts
// The mechanical spine: server-rolled move resolution — roll math,
// modifiers, classification parsing, and outcome bands.

import { describe, it, expect } from 'vitest'
import {
  rollD6,
  capabilityModifier,
  harmPenalty,
  computeMechanics,
  parseClassifications,
  formatRollReceipt,
  describeOutcomeBand,
  CharacterForRoll,
} from '../resolution'

// Deterministic RNG factory: yields the given values (0..1) in order.
const seq = (...values: number[]) => {
  let i = 0
  return () => values[i++ % values.length]
}

const baseCharacter: CharacterForRoll = {
  id: 'char1',
  name: 'Jason',
  stats: { cool: 1, hard: -1, hot: 0, sharp: 2, weird: 0 },
  harm: 0,
  capabilities: [
    {
      state: 'UNLOCKED',
      proficiency: 62, // skilled
      framedLabel: 'Kendo forms',
      capability: { key: 'swordplay', name: 'Swordplay' },
    },
    {
      state: 'GLIMPSED',
      proficiency: 0,
      framedLabel: null,
      capability: { key: 'essence-magic', name: 'Essence Magic' },
    },
  ],
}

describe('rollD6', () => {
  it('maps the rng range onto 1..6', () => {
    expect(rollD6(() => 0)).toBe(1)
    expect(rollD6(() => 0.999)).toBe(6)
  })
})

describe('capabilityModifier', () => {
  it('penalizes the truly unknown and rewards mastery', () => {
    expect(capabilityModifier(false, 'untrained')).toBe(-1)
    expect(capabilityModifier(true, 'novice')).toBe(0)
    expect(capabilityModifier(true, 'competent')).toBe(1)
    expect(capabilityModifier(true, 'skilled')).toBe(1)
    expect(capabilityModifier(true, 'masterful')).toBe(2)
  })
})

describe('harmPenalty', () => {
  it('applies the Impaired rule at 4+ harm', () => {
    expect(harmPenalty(3)).toBe(0)
    expect(harmPenalty(4)).toBe(-1)
    expect(harmPenalty(6)).toBe(-1)
  })
})

describe('computeMechanics', () => {
  it('rolls 2d6 + stat + capability and bands the outcome', () => {
    // dice: 4 and 4 (rng 0.5, 0.5) → 8; +1 cool +1 skilled swordplay = 10 → strong hit
    const m = computeMechanics(
      { action_index: 0, move_name: 'Act Under Fire', stat_key: 'cool', capability_key: 'Swordplay' },
      { id: 'a1' },
      baseCharacter,
      seq(0.5, 0.5)
    )
    expect(m).not.toBeNull()
    expect(m!.dice).toEqual([4, 4])
    expect(m!.statMod).toBe(1)
    expect(m!.capabilityMod).toBe(1)
    expect(m!.capabilityName).toBe('Kendo forms')
    expect(m!.total).toBe(10)
    expect(m!.outcome).toBe('strongHit')
    expect(m!.outcomeText.length).toBeGreaterThan(0)
  })

  it('penalizes attempting a system the character has only glimpsed', () => {
    // dice 4+4=8, +0 weird, -1 glimpsed essence magic = 7 → weak hit
    const m = computeMechanics(
      { action_index: 0, move_name: 'Open Your Brain', stat_key: 'weird', capability_key: 'Essence Magic' },
      { id: 'a1' },
      baseCharacter,
      seq(0.5, 0.5)
    )
    expect(m!.capabilityMod).toBe(-1)
    expect(m!.total).toBe(7)
    expect(m!.outcome).toBe('weakHit')
  })

  it('applies the harm penalty and can land a miss', () => {
    // dice 2+3=5, -1 hard, -1 impaired = 3 → miss
    const hurt = { ...baseCharacter, harm: 5 }
    const m = computeMechanics(
      { action_index: 0, move_name: 'Go Aggro', stat_key: 'hard', capability_key: null },
      { id: 'a1' },
      hurt,
      seq(1 / 6, 2 / 6)
    )
    expect(m!.harmPenalty).toBe(-1)
    expect(m!.total).toBe(3)
    expect(m!.outcome).toBe('miss')
  })

  it('returns null for no_roll and unknown moves', () => {
    expect(
      computeMechanics(
        { action_index: 0, move_name: 'no_roll', stat_key: 'cool', capability_key: null },
        { id: 'a1' }, baseCharacter, seq(0.5)
      )
    ).toBeNull()
    expect(
      computeMechanics(
        { action_index: 0, move_name: 'Made Up Move', stat_key: 'cool', capability_key: null },
        { id: 'a1' }, baseCharacter, seq(0.5)
      )
    ).toBeNull()
  })

  it('falls back to cool for invalid stat keys and clamps stat mods', () => {
    const weird = { ...baseCharacter, stats: { cool: 9 } as any }
    const m = computeMechanics(
      { action_index: 0, move_name: 'Act Under Fire', stat_key: 'charisma', capability_key: null },
      { id: 'a1' }, weird, seq(0.5, 0.5)
    )
    expect(m!.statKey).toBe('cool')
    expect(m!.statMod).toBe(3) // clamped from 9
  })
})

describe('parseClassifications', () => {
  it('keeps only valid, in-range classifications', () => {
    const parsed = parseClassifications(
      {
        classifications: [
          { action_index: 0, move_name: 'Act Under Fire', stat_key: 'cool', capability_key: 'Swordplay' },
          { action_index: 1, move_name: 'no_roll' },
          { action_index: 5, move_name: 'Act Under Fire' }, // out of range
          { action_index: 0, move_name: 'Fireball' }, // not a real move
          { move_name: 'Act Under Fire' }, // missing index
        ],
      },
      2
    )
    expect(parsed).toHaveLength(2)
    expect(parsed[0]).toEqual({
      action_index: 0, move_name: 'Act Under Fire', stat_key: 'cool', capability_key: 'Swordplay',
    })
    expect(parsed[1].move_name).toBe('no_roll')
    expect(parsed[1].capability_key).toBeNull()
  })

  it('fails open on garbage', () => {
    expect(parseClassifications(null, 3)).toEqual([])
    expect(parseClassifications({ nope: true }, 3)).toEqual([])
  })
})

describe('receipts and band text', () => {
  it('formats a readable receipt with full breakdown', () => {
    const m = computeMechanics(
      { action_index: 0, move_name: 'Act Under Fire', stat_key: 'cool', capability_key: 'Swordplay' },
      { id: 'a1' }, baseCharacter, seq(0.5, 0.5)
    )!
    const receipt = formatRollReceipt(m)
    expect(receipt).toContain('Act Under Fire')
    expect(receipt).toContain('2d6 (4+4)')
    expect(receipt).toContain('+1 cool')
    expect(receipt).toContain('+1 Kendo forms')
    expect(receipt).toContain('= 10 — strong hit')
  })

  it('describes every band', () => {
    expect(describeOutcomeBand('strongHit')).toContain('STRONG HIT')
    expect(describeOutcomeBand('weakHit')).toContain('cost')
    expect(describeOutcomeBand('miss')).toContain('hard GM move')
  })
})
