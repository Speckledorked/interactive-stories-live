// src/lib/game/__tests__/resolution.goldenVectors.test.ts
//
// Golden-vector regression suite for computeMechanics: a fixed RNG sequence
// plus a fixed set of inputs pinned against a fixed expected total/outcome,
// run as one parameterized table. resolution.test.ts already covers each
// modifier's own logic in isolation (weatherPenalty, conditionPenalty, ...);
// this file exists for a different failure mode — a future change to
// computeMechanics' summation (dropped term, wrong sign, double-counted
// modifier) that no single-modifier test would catch because each of those
// only varies one input at a time. Every vector here stacks multiple
// modifiers and pins the exact resulting total, the same way a golden-vector
// test would pin a dice roll's outcome for a given seed.
//
// A failing vector means the roll math changed — confirm that's intentional
// (and update the pinned value with the reasoning) rather than assuming the
// test is wrong.

import { describe, it, expect } from 'vitest'
import { computeMechanics, CharacterForRoll, ActionClassification, RollContext, Rng } from '../resolution'

const seq = (...values: number[]): Rng => {
  let i = 0
  return () => values[i++ % values.length]
}

const character: CharacterForRoll = {
  id: 'char1',
  name: 'Jason',
  stats: { cool: 1, hard: -1, hot: 0, sharp: 2, weird: 0 },
  harm: 0,
  capabilities: [
    {
      state: 'UNLOCKED',
      proficiency: 90, // masterful
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
  signatures: [{ id: 'perk:battle_hardened', name: 'Battle Hardened', trigger: 'Fighting multiple foes' }],
}

function classify(overrides: Partial<ActionClassification> = {}): ActionClassification {
  return {
    action_index: 0,
    move_name: 'Act Under Fire',
    stat_key: 'cool',
    capability_key: null,
    faction_name: null,
    ...overrides,
  }
}

interface Vector {
  name: string
  rngValues: number[]
  classification: Partial<ActionClassification>
  character?: Partial<CharacterForRoll>
  context?: RollContext
  expected: { dice: [number, number]; total: number; outcome: 'strongHit' | 'weakHit' | 'miss' }
}

const VECTORS: Vector[] = [
  {
    name: 'bare stat roll, low dice',
    rngValues: [0, 0],
    classification: { stat_key: 'cool' },
    expected: { dice: [1, 1], total: 3, outcome: 'miss' }, // 1+1+1(cool)
  },
  {
    name: 'bare stat roll, max dice',
    rngValues: [0.999, 0.999],
    classification: { stat_key: 'hard' },
    expected: { dice: [6, 6], total: 11, outcome: 'strongHit' }, // 6+6-1(hard)
  },
  {
    name: 'masterful capability stacked on a mid roll',
    rngValues: [1 / 6, 2 / 6],
    classification: { stat_key: 'cool', capability_key: 'Swordplay' },
    expected: { dice: [2, 3], total: 8, outcome: 'weakHit' }, // 2+3+1(cool)+2(masterful)
  },
  {
    name: 'glimpsed capability penalty stacked with harm',
    rngValues: [0.5, 0.5],
    classification: { stat_key: 'weird', capability_key: 'Essence Magic' },
    character: { harm: 5 },
    expected: { dice: [4, 4], total: 6, outcome: 'miss' }, // 4+4+0(weird)-1(glimpsed)-1(impaired)
  },
  {
    name: 'faction standing + relationship + debt all favorable',
    rngValues: [0.5, 0.5],
    classification: { stat_key: 'hot', faction_name: 'Thieves Guild', npc_name: 'Lord Kessler' },
    context: {
      faction: { name: 'Thieves Guild', isActive: true, influence: 70, standing: 3 },
      relationship: { npcName: 'Lord Kessler', trust: 80, tension: 10, respect: 60 },
      debts: { counterpartyName: 'Lord Kessler', owedToCharacter: 2, owedByCharacter: 0 },
    },
    // 4+4+0(hot)+2(standing cap)+2(relationship: (80+60-10)/50=2.6->2)+2(debt cap) = 14
    expected: { dice: [4, 4], total: 14, outcome: 'strongHit' },
  },
  {
    name: 'weather + contested + ruined site all hostile',
    rngValues: [0.5, 0.5],
    classification: { stat_key: 'cool' },
    context: {
      weather: { condition: 'STORM', severity: 5 },
      isContestedLocation: true,
      locationConditionScore: 10,
    },
    expected: { dice: [4, 4], total: 6, outcome: 'miss' }, // 4+4+1(cool)-1(weather)-1(contested)-1(site)
  },
  {
    name: 'melee engagement at close range plus a matched signature',
    rngValues: [0.5, 0.5],
    classification: { stat_key: 'hard', engagement: 'melee', matched_signature_id: 'perk:battle_hardened' } as Partial<ActionClassification>,
    character: { currentZone: 'close', zoneMetadata: { sceneId: 'scene1' } } as Partial<CharacterForRoll>,
    context: { sceneId: 'scene1' },
    expected: { dice: [4, 4], total: 9, outcome: 'weakHit' }, // 4+4-1(hard)+1(melee close)+1(signature)
  },
  {
    name: 'stacked negative conditions plus a stat-shaped condition effect',
    rngValues: [0.5, 0.5],
    classification: { stat_key: 'hard' },
    character: {
      conditions: [
        { rollModifier: -1 },
        { rollModifier: -1 },
        { statModifiers: { hard: 2 } },
      ],
    } as Partial<CharacterForRoll>,
    expected: { dice: [4, 4], total: 7, outcome: 'weakHit' }, // 4+4-1(hard)-2(conditionMod)+2(conditionStatMod)
  },
  {
    name: 'corruption surge on top of an already-modified roll',
    rngValues: [0.5, 0.5],
    classification: { stat_key: 'cool', accepts_bargain: true },
    character: { corruption: 1, pendingBargainOffer: 'The essence will carry you across' } as Partial<CharacterForRoll>,
    expected: { dice: [4, 4], total: 11, outcome: 'strongHit' }, // 4+4+1(cool)+2(surge)
  },
  {
    name: 'kitchen sink: every favorable modifier stacked in one roll',
    rngValues: [0.5, 0.5],
    classification: {
      stat_key: 'sharp',
      capability_key: 'Swordplay',
      faction_name: 'Thieves Guild',
      npc_name: 'Lord Kessler',
      matched_signature_id: 'perk:battle_hardened',
      engagement: 'ranged',
    } as Partial<ActionClassification>,
    character: { currentZone: 'near', zoneMetadata: { sceneId: 'scene1' } } as Partial<CharacterForRoll>,
    context: {
      faction: { name: 'Thieves Guild', isActive: true, influence: 70, standing: 3 },
      relationship: { npcName: 'Lord Kessler', trust: 80, tension: 10, respect: 60 },
      debts: { counterpartyName: 'Lord Kessler', owedToCharacter: 2, owedByCharacter: 0 },
      sceneId: 'scene1',
    },
    // 4+4+2(sharp)+2(masterful)+2(standing)+2(relationship)+2(debt)+1(signature)+1(ranged near) = 20
    expected: { dice: [4, 4], total: 20, outcome: 'strongHit' },
  },
  {
    name: 'kitchen sink: every unfavorable modifier stacked in one roll',
    rngValues: [0, 0],
    classification: { stat_key: 'weird', capability_key: 'Essence Magic', engagement: 'melee' },
    character: {
      harm: 6,
      currentZone: 'distant',
      zoneMetadata: { sceneId: 'scene1' },
      conditions: [{ rollModifier: -1 }],
    } as Partial<CharacterForRoll>,
    context: {
      weather: { condition: 'SNOW', severity: 5 },
      isContestedLocation: true,
      locationConditionScore: 5,
      sceneId: 'scene1',
    },
    // 1+1+0(weird)-1(glimpsed)-1(impaired)-1(weather)-1(contested)-1(site)-1(condition)-2(melee distant) = -6
    expected: { dice: [1, 1], total: -6, outcome: 'miss' },
  },
]

describe('computeMechanics — golden vectors', () => {
  it.each(VECTORS)('$name', (vector) => {
    const m = computeMechanics(
      classify(vector.classification),
      { id: 'a1' },
      { ...character, ...vector.character },
      seq(...vector.rngValues),
      vector.context ?? {}
    )
    expect(m).not.toBeNull()
    expect(m!.dice).toEqual(vector.expected.dice)
    expect(m!.total).toBe(vector.expected.total)
    expect(m!.outcome).toBe(vector.expected.outcome)
  })
})
