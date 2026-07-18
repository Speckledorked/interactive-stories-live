// src/lib/game/__tests__/resolution.test.ts
// The mechanical spine: server-rolled move resolution — roll math,
// modifiers, classification parsing, and outcome bands.

import { describe, it, expect } from 'vitest'
import {
  rollD6,
  capabilityModifier,
  harmPenalty,
  relationshipModifier,
  weatherPenalty,
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
  it('applies the corruption surge when the action accepts an open bargain', () => {
    // dice 4+4=8, +1 cool, +2 surge = 11 → strong hit
    const m = computeMechanics(
      { action_index: 0, move_name: 'Act Under Fire', stat_key: 'cool', capability_key: null, faction_name: null, accepts_bargain: true },
      { id: 'a1' },
      { ...baseCharacter, corruption: 1, pendingBargainOffer: 'The essence will carry you across' },
      seq(0.5, 0.5)
    )
    expect(m!.corruptionSurgeBonus).toBe(2)
    expect(m!.total).toBe(11)
    expect(m!.outcome).toBe('strongHit')
  })

  it('grants no surge without an open bargain, when the classifier does not flag acceptance, or at max corruption', () => {
    const accepted = { action_index: 0, move_name: 'Act Under Fire', stat_key: 'cool', capability_key: null, faction_name: null, accepts_bargain: true }
    // accepts_bargain but nothing pending
    const noOffer = computeMechanics(accepted, { id: 'a1' }, { ...baseCharacter, corruption: 1 }, seq(0.5, 0.5))
    expect(noOffer!.corruptionSurgeBonus).toBe(0)
    // pending offer but not accepted
    const notAccepted = computeMechanics(
      { ...accepted, accepts_bargain: false },
      { id: 'a1' },
      { ...baseCharacter, corruption: 1, pendingBargainOffer: 'offer' },
      seq(0.5, 0.5)
    )
    expect(notAccepted!.corruptionSurgeBonus).toBe(0)
    // fully consumed characters have nothing left to spend
    const consumed = computeMechanics(
      accepted,
      { id: 'a1' },
      { ...baseCharacter, corruption: 5, pendingBargainOffer: 'offer' },
      seq(0.5, 0.5)
    )
    expect(consumed!.corruptionSurgeBonus).toBe(0)
  })

  it('rolls 2d6 + stat + capability and bands the outcome', () => {
    // dice: 4 and 4 (rng 0.5, 0.5) → 8; +1 cool +1 skilled swordplay = 10 → strong hit
    const m = computeMechanics(
      { action_index: 0, move_name: 'Act Under Fire', stat_key: 'cool', capability_key: 'Swordplay', faction_name: null },
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
      { action_index: 0, move_name: 'Open Your Brain', stat_key: 'weird', capability_key: 'Essence Magic', faction_name: null },
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
      { action_index: 0, move_name: 'Go Aggro', stat_key: 'hard', capability_key: null, faction_name: null },
      { id: 'a1' },
      hurt,
      seq(1 / 6, 2 / 6)
    )
    expect(m!.harmPenalty).toBe(-1)
    expect(m!.total).toBe(3)
    expect(m!.outcome).toBe('miss')
  })

  it('adds standing weight against live faction state', () => {
    // dice 4+4=8, +0 hot, +2 honored by an influential faction = 10 → strong hit
    const m = computeMechanics(
      { action_index: 0, move_name: 'Seduce or Manipulate', stat_key: 'hot', capability_key: null, faction_name: 'Thieves Guild' },
      { id: 'a1' },
      baseCharacter,
      seq(0.5, 0.5),
      { name: 'Thieves Guild', isActive: true, influence: 70, standing: 3 }
    )
    expect(m!.standingMod).toBe(2) // ±2 cap even at +3 standing
    expect(m!.factionName).toBe('Thieves Guild')
    expect(m!.total).toBe(10)

    // Same roll, same standing — but the faction collapsed offscreen.
    const collapsed = computeMechanics(
      { action_index: 0, move_name: 'Seduce or Manipulate', stat_key: 'hot', capability_key: null, faction_name: 'Thieves Guild' },
      { id: 'a1' },
      baseCharacter,
      seq(0.5, 0.5),
      { name: 'Thieves Guild', isActive: false, influence: 70, standing: 3 }
    )
    expect(collapsed!.standingMod).toBe(0)
    expect(collapsed!.total).toBe(8)
    expect(collapsed!.outcome).toBe('weakHit')
  })

  it('returns null for no_roll and unknown moves', () => {
    expect(
      computeMechanics(
        { action_index: 0, move_name: 'no_roll', stat_key: 'cool', capability_key: null, faction_name: null },
        { id: 'a1' }, baseCharacter, seq(0.5)
      )
    ).toBeNull()
    expect(
      computeMechanics(
        { action_index: 0, move_name: 'Made Up Move', stat_key: 'cool', capability_key: null, faction_name: null },
        { id: 'a1' }, baseCharacter, seq(0.5)
      )
    ).toBeNull()
  })

  it('falls back to cool for invalid stat keys and clamps stat mods', () => {
    const weird = { ...baseCharacter, stats: { cool: 9 } as any }
    const m = computeMechanics(
      { action_index: 0, move_name: 'Act Under Fire', stat_key: 'charisma', capability_key: null, faction_name: null },
      { id: 'a1' }, weird, seq(0.5, 0.5)
    )
    expect(m!.statKey).toBe('cool')
    expect(m!.statMod).toBe(3) // clamped from 9
  })
})

describe('relationshipModifier', () => {
  it('is 0 with no relationship on record', () => {
    expect(relationshipModifier(null)).toBe(0)
    expect(relationshipModifier(undefined)).toBe(0)
  })

  it('caps at +2 for a maxed-out warm relationship', () => {
    expect(relationshipModifier({ npcName: 'Kessler', trust: 100, tension: 0, respect: 100 })).toBe(2)
  })

  it('caps at -2 for a maxed-out hostile relationship', () => {
    expect(relationshipModifier({ npcName: 'Kessler', trust: 0, tension: 100, respect: 0 })).toBe(-2)
  })

  it('nets trust + respect - tension, scaled down and rounded', () => {
    // (60 + 20 - 30) / 50 = 1.0 -> +1
    expect(relationshipModifier({ npcName: 'Kessler', trust: 60, tension: 30, respect: 20 })).toBe(1)
  })

  it('is 0 for a neutral (all-zero) relationship', () => {
    expect(relationshipModifier({ npcName: 'Kessler', trust: 0, tension: 0, respect: 0 })).toBe(0)
  })
})

describe('computeMechanics — relationship weight', () => {
  it('adds rapport weight against a specific NPC', () => {
    // dice 4+4=8, +0 hot, +2 warm relationship = 10 -> strong hit
    const m = computeMechanics(
      { action_index: 0, move_name: 'Seduce or Manipulate', stat_key: 'hot', capability_key: null, faction_name: null, npc_name: 'Lord Kessler' },
      { id: 'a1' },
      baseCharacter,
      seq(0.5, 0.5),
      null,
      { npcName: 'Lord Kessler', trust: 100, tension: 0, respect: 100 }
    )
    expect(m!.relationshipMod).toBe(2)
    expect(m!.npcName).toBe('Lord Kessler')
    expect(m!.total).toBe(10)
  })

  it('is unaffected when no relationship is passed', () => {
    const m = computeMechanics(
      { action_index: 0, move_name: 'Act Under Fire', stat_key: 'cool', capability_key: null, faction_name: null },
      { id: 'a1' },
      baseCharacter,
      seq(0.5, 0.5)
    )
    expect(m!.relationshipMod).toBe(0)
    expect(m!.npcName).toBeNull()
  })
})

describe('weatherPenalty', () => {
  it('is 0 with no weather on record', () => {
    expect(weatherPenalty(null)).toBe(0)
    expect(weatherPenalty(undefined)).toBe(0)
  })

  it('never penalizes CLEAR or CLOUDY regardless of severity', () => {
    expect(weatherPenalty({ condition: 'CLEAR', severity: 5 })).toBe(0)
    expect(weatherPenalty({ condition: 'CLOUDY', severity: 5 })).toBe(0)
  })

  it('penalizes a severe (4+) non-benign condition', () => {
    expect(weatherPenalty({ condition: 'STORM', severity: 4 })).toBe(-1)
    expect(weatherPenalty({ condition: 'SNOW', severity: 5 })).toBe(-1)
    expect(weatherPenalty({ condition: 'FOG', severity: 4 })).toBe(-1)
  })

  it('does not penalize a mild non-benign condition', () => {
    expect(weatherPenalty({ condition: 'RAIN', severity: 2 })).toBe(0)
    expect(weatherPenalty({ condition: 'STORM', severity: 3 })).toBe(0)
  })
})

describe('computeMechanics — weather weight', () => {
  it('applies a penalty in severe weather', () => {
    // dice 4+4=8, +1 cool, -1 severe storm = 8 -> weak hit
    const m = computeMechanics(
      { action_index: 0, move_name: 'Act Under Fire', stat_key: 'cool', capability_key: null, faction_name: null },
      { id: 'a1' },
      baseCharacter,
      seq(0.5, 0.5),
      null,
      null,
      { condition: 'STORM', severity: 5 }
    )
    expect(m!.weatherMod).toBe(-1)
    expect(m!.weatherCondition).toBe('STORM')
    expect(m!.total).toBe(8)
    expect(m!.outcome).toBe('weakHit')
  })

  it('is unaffected by clear weather or no weather at all', () => {
    const clear = computeMechanics(
      { action_index: 0, move_name: 'Act Under Fire', stat_key: 'cool', capability_key: null, faction_name: null },
      { id: 'a1' }, baseCharacter, seq(0.5, 0.5), null, null, { condition: 'CLEAR', severity: 3 }
    )
    expect(clear!.weatherMod).toBe(0)
    expect(clear!.weatherCondition).toBeNull()

    const none = computeMechanics(
      { action_index: 0, move_name: 'Act Under Fire', stat_key: 'cool', capability_key: null, faction_name: null },
      { id: 'a1' }, baseCharacter, seq(0.5, 0.5)
    )
    expect(none!.weatherMod).toBe(0)
    expect(none!.weatherCondition).toBeNull()
  })
})

describe('computeMechanics — per-campaign move flavor', () => {
  it('overrides moveName and outcomeText when flavor is supplied, leaving the math untouched', () => {
    // dice 4+4=8, +1 cool = 9 -> weak hit
    const m = computeMechanics(
      { action_index: 0, move_name: 'Act Under Fire', stat_key: 'cool', capability_key: null, faction_name: null },
      { id: 'a1' },
      baseCharacter,
      seq(0.5, 0.5),
      null,
      null,
      null,
      { name: 'Face the Storm', outcomes: { strongHit: 'You weather it cleanly.', weakHit: 'You weather it, but the storm exacts its due.', miss: 'The storm takes what it wants.' } }
    )
    expect(m!.total).toBe(9)
    expect(m!.outcome).toBe('weakHit')
    expect(m!.moveName).toBe('Face the Storm')
    expect(m!.outcomeText).toBe('You weather it, but the storm exacts its due.')
  })

  it('falls back to the generic band text when flavor omits that specific band', () => {
    const m = computeMechanics(
      { action_index: 0, move_name: 'Act Under Fire', stat_key: 'cool', capability_key: null, faction_name: null },
      { id: 'a1' },
      baseCharacter,
      seq(0.5, 0.5),
      null,
      null,
      null,
      { name: 'Face the Storm', outcomes: {} }
    )
    expect(m!.moveName).toBe('Face the Storm')
    expect(m!.outcomeText).toBe('You do it, but there\'s a complication or cost.')
  })

  it('uses the generic BASIC_MOVES name and text when no flavor is supplied', () => {
    const m = computeMechanics(
      { action_index: 0, move_name: 'Act Under Fire', stat_key: 'cool', capability_key: null, faction_name: null },
      { id: 'a1' },
      baseCharacter,
      seq(0.5, 0.5)
    )
    expect(m!.moveName).toBe('Act Under Fire')
    expect(m!.outcomeText).toBe('You do it, but there\'s a complication or cost.')
  })
})

describe('parseClassifications', () => {
  it('keeps only valid, in-range classifications', () => {
    const parsed = parseClassifications(
      {
        classifications: [
          { action_index: 0, move_name: 'Act Under Fire', stat_key: 'cool', capability_key: 'Swordplay', faction_name: null },
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
      action_index: 0, move_name: 'Act Under Fire', stat_key: 'cool', capability_key: 'Swordplay', faction_name: null, npc_name: null, accepts_bargain: false,
    })
    expect(parsed[1].move_name).toBe('no_roll')
    expect(parsed[1].capability_key).toBeNull()
    expect(parsed[1].faction_name).toBeNull()
    expect(parsed[1].npc_name).toBeNull()
  })

  it('fails open on garbage', () => {
    expect(parseClassifications(null, 3)).toEqual([])
    expect(parseClassifications({ nope: true }, 3)).toEqual([])
  })
})

describe('receipts and band text', () => {
  it('formats a readable receipt with full breakdown', () => {
    const m = computeMechanics(
      { action_index: 0, move_name: 'Act Under Fire', stat_key: 'cool', capability_key: 'Swordplay', faction_name: null },
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

describe('parseClassifications accepts_bargain passthrough', () => {
  it('passes true through and defaults anything else to false', () => {
    const parsed = parseClassifications(
      {
        classifications: [
          { action_index: 0, move_name: 'Act Under Fire', stat_key: 'cool', accepts_bargain: true },
          { action_index: 1, move_name: 'Act Under Fire', stat_key: 'cool', accepts_bargain: 'yes' },
          { action_index: 2, move_name: 'Act Under Fire', stat_key: 'cool' },
        ],
      },
      3
    )
    expect(parsed[0].accepts_bargain).toBe(true)
    expect(parsed[1].accepts_bargain).toBe(false)
    expect(parsed[2].accepts_bargain).toBe(false)
  })
})
