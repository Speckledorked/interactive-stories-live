// src/lib/game/__tests__/conditionEffects.test.ts
//
// Condition effects that the engine actually executes (#88).
//
// `mechanicalEffect` is free text and always was — Bleeding has said "1
// harm per turn" since the day it was written, and nothing anywhere
// applied it. These cover the structured fields that replaced that
// promise with enforcement, plus the safety rule that keeps a background
// tick from killing anyone.

import { describe, it, expect } from 'vitest'
import {
  recurringHarmForScene,
  applyRecurringHarm,
  conditionStatModifier,
  RECURRING_HARM_CEILING,
  CONDITION_STAT_MOD_BOUND,
  COMMON_CONDITIONS,
  type Condition,
} from '../harm'

const cond = (over: Partial<Condition>): Condition =>
  ({ id: 'c', name: 'X', category: 'Physical', description: 'x', ...over } as Condition)

describe('recurringHarmForScene', () => {
  it('sums the harm active conditions inflict', () => {
    expect(recurringHarmForScene([cond({ harmPerScene: 1 }), cond({ harmPerScene: 2 })])).toBe(3)
  })

  it('is zero when nothing inflicts anything', () => {
    expect(recurringHarmForScene([cond({ rollModifier: -1 })])).toBe(0)
    expect(recurringHarmForScene([])).toBe(0)
    expect(recurringHarmForScene(null)).toBe(0)
  })

  it('ignores malformed or negative values rather than healing anyone', () => {
    // A condition is not a bandage.
    expect(recurringHarmForScene([cond({ harmPerScene: -3 })])).toBe(0)
    expect(recurringHarmForScene([cond({ harmPerScene: NaN })])).toBe(0)
    expect(recurringHarmForScene([cond({ harmPerScene: 'two' as unknown as number })])).toBe(0)
  })
})

describe('applyRecurringHarm', () => {
  it('deals the harm', () => {
    expect(applyRecurringHarm(1, 2)).toEqual({ newHarm: 3, dealt: 2 })
  })

  it('never carries anyone past Impaired into Taken Out', () => {
    // THE safety rule. Taken Out is resolved by a server-side recovery
    // roll during scene resolution — a narrated moment with the death-save
    // path behind it. There is no such moment in the gap before a scene
    // starts, so a condition ticking away must not kill someone while
    // nobody is looking.
    expect(applyRecurringHarm(4, 3)).toEqual({ newHarm: RECURRING_HARM_CEILING, dealt: 1 })
    expect(applyRecurringHarm(5, 5)).toEqual({ newHarm: 5, dealt: 0 })
  })

  it('does nothing to someone already at or past the ceiling', () => {
    expect(applyRecurringHarm(6, 2).dealt).toBe(0)
    expect(applyRecurringHarm(5, 1).dealt).toBe(0)
  })

  it('is a no-op with no recurring harm', () => {
    expect(applyRecurringHarm(2, 0)).toEqual({ newHarm: 2, dealt: 0 })
  })

  it('clamps a malformed starting harm rather than propagating it', () => {
    expect(applyRecurringHarm(NaN as unknown as number, 1).newHarm).toBe(1)
    expect(applyRecurringHarm(-4 as unknown as number, 1).newHarm).toBe(1)
  })
})

describe('conditionStatModifier', () => {
  const enraged = cond({ statModifiers: { hard: 1, hot: -2 } })

  it('helps at one stat and hurts at another from a single condition', () => {
    // The whole reason this field exists: rollModifier can express one
    // undirected number, and Enraged is not one undirected number.
    expect(conditionStatModifier([enraged], 'hard')).toBe(1)
    expect(conditionStatModifier([enraged], 'hot')).toBe(-2)
  })

  it('is silent on stats the condition says nothing about', () => {
    expect(conditionStatModifier([enraged], 'sharp')).toBe(0)
    expect(conditionStatModifier([enraged], 'weird')).toBe(0)
  })

  it('sums across conditions', () => {
    expect(conditionStatModifier([cond({ statModifiers: { hard: 1 } }), cond({ statModifiers: { hard: 1 } })], 'hard')).toBe(2)
  })

  it('bounds a stack so conditions cannot invert a roll outright', () => {
    const many = Array(5).fill(cond({ statModifiers: { hard: -2 } }))
    expect(conditionStatModifier(many, 'hard')).toBe(-CONDITION_STAT_MOD_BOUND)
    const boons = Array(5).fill(cond({ statModifiers: { hard: 2 } }))
    expect(conditionStatModifier(boons, 'hard')).toBe(CONDITION_STAT_MOD_BOUND)
  })

  it('ignores conditions with no stat modifiers, and malformed ones', () => {
    expect(conditionStatModifier([cond({ rollModifier: -1 })], 'hard')).toBe(0)
    expect(conditionStatModifier([cond({ statModifiers: 'nope' as any })], 'hard')).toBe(0)
    expect(conditionStatModifier([cond({ statModifiers: { hard: NaN } })], 'hard')).toBe(0)
    expect(conditionStatModifier(null, 'hard')).toBe(0)
  })
})

describe('COMMON_CONDITIONS no longer promise rules nothing executes', () => {
  it('Bleeding actually bleeds', () => {
    // This is the flagship #88 case: the text said "1 harm per turn" from
    // the day it was written and the engine never applied it.
    expect(COMMON_CONDITIONS.bleeding.harmPerScene).toBe(1)
  })

  it('Enraged actually helps in a fight and hurts in a conversation', () => {
    expect(COMMON_CONDITIONS.enraged.statModifiers).toEqual({ hard: 1, hot: -2 })
  })

  it('every condition whose text names a number has a field behind it', () => {
    // The invariant the whole entry is about. A condition may be purely
    // narrative — Cursed and Marked are, deliberately — but it may not
    // quote a modifier or a damage figure that nothing applies.
    for (const [key, c] of Object.entries(COMMON_CONDITIONS)) {
      const text = c.mechanicalEffect || ''
      const promisesModifier = /[+-]\s*\d/.test(text)
      const promisesHarm = /\d\s*harm/i.test(text)
      if (promisesModifier) {
        const enforced =
          typeof c.rollModifier === 'number' ||
          (c.statModifiers && Object.keys(c.statModifiers).length > 0)
        expect(enforced, `${key} quotes a modifier ("${text}") with nothing enforcing it`).toBeTruthy()
      }
      if (promisesHarm) {
        expect(c.harmPerScene, `${key} quotes harm ("${text}") with nothing enforcing it`).toBeGreaterThan(0)
      }
    }
  })

  it('leaves the purely narrative conditions honestly unenforced', () => {
    // Cursed and Marked describe fiction the GM plays, not arithmetic.
    // They should carry no enforced fields AND quote no numbers — which
    // the invariant above already checks the other way round.
    for (const key of ['cursed', 'marked', 'unstable']) {
      const c = COMMON_CONDITIONS[key]
      expect(c.harmPerScene, `${key}`).toBeUndefined()
      expect(c.statModifiers, `${key}`).toBeUndefined()
    }
  })
})
