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
  accrueNaturalRecovery,
  applyRest,
  parseHarmState,
  createDefaultHarmState,
  validateHarmState,
  blocksNaturalRecovery,
  HOURS_PER_HARM_RECOVERED,
  stabilizeCharacter,
  CRITICALLY_DYING_CONDITION_NAME,
  findConditionTemplate,
  applyConditionTemplate,
  createConditionFromTemplate,
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

// ---------------------------------------------------------------------------
// The catalogue reaching production
// ---------------------------------------------------------------------------
// COMMON_CONDITIONS had NO production consumer: nothing instantiated it,
// and applyHarm built its one auto-condition inline. So the entries
// specifying Bleeding's harm and Enraged's stat split were only ever true
// of a table nobody read — a narrator writing "Bleeding" got whatever
// fields it happened to report, which was usually none.

describe('findConditionTemplate', () => {
  it('matches on the display name the fiction actually writes', () => {
    expect(findConditionTemplate('Bleeding')?.harmPerScene).toBe(1)
    expect(findConditionTemplate('bleeding')?.harmPerScene).toBe(1)
    expect(findConditionTemplate('  BLEEDING  ')?.harmPerScene).toBe(1)
  })

  it('returns nothing for a condition the fiction invented', () => {
    expect(findConditionTemplate('Hexed by the Moon')).toBeNull()
    expect(findConditionTemplate('')).toBeNull()
    expect(findConditionTemplate(null)).toBeNull()
  })
})

describe('applyConditionTemplate', () => {
  it('supplies the enforced fields a bare report left out', () => {
    // THE fix: "Bleeding" with nothing else now actually bleeds.
    const filled = applyConditionTemplate({ name: 'Bleeding' })
    expect(filled.harmPerScene).toBe(1)
    expect(filled.mechanicalEffect).toBeTruthy()
  })

  it('fills stat effects for a stock condition too', () => {
    expect(applyConditionTemplate({ name: 'Enraged' }).statModifiers).toEqual({ hard: 1, hot: -2 })
  })

  it('lets an explicit report win over the catalogue', () => {
    // A narrator deliberately writing a nastier Bleeding keeps it.
    expect(applyConditionTemplate({ name: 'Bleeding', harmPerScene: 3 }).harmPerScene).toBe(3)
    expect(applyConditionTemplate({ name: 'Stunned', rollModifier: -2 }).rollModifier).toBe(-2)
  })

  it('does not resurrect a field the catalogue also leaves unset', () => {
    expect(applyConditionTemplate({ name: 'Cursed' }).harmPerScene).toBeUndefined()
    expect(applyConditionTemplate({ name: 'Cursed' }).statModifiers).toBeUndefined()
  })

  it('passes an invented condition through untouched', () => {
    const invented = { name: 'Hexed by the Moon', rollModifier: -1 }
    expect(applyConditionTemplate(invented)).toEqual(invented)
  })
})

describe('createConditionFromTemplate', () => {
  it('builds Taken Out with the text canAct keys off', () => {
    // applyHarm used to construct this inline, so two definitions of what
    // Taken Out means could drift apart.
    const c = createConditionFromTemplate('taken_out', 4)
    expect(c.name).toBe('Taken Out')
    expect(c.mechanicalEffect?.toLowerCase()).toContain('cannot take actions')
    expect(c.appliedAt).toBe(4)
  })
})

describe('stabilizeCharacter', () => {
  const dying = (): any[] => ([
    { id: 'd1', name: CRITICALLY_DYING_CONDITION_NAME, category: 'Physical', description: 'x', mechanicalEffect: 'Cannot act' },
  ])

  it('clears the dying condition — that is what stabilizing MEANS', () => {
    // This function existed with no callers while the one code path that
    // needed it cleared the condition by hand. Leaving it to the caller is
    // exactly how the two drifted.
    const { updatedConditions } = stabilizeCharacter(dying(), 4)
    expect(updatedConditions.some(c => c.name === CRITICALLY_DYING_CONDITION_NAME)).toBe(false)
  })

  it('adds Stabilized with the text canAct reads', () => {
    const { updatedConditions } = stabilizeCharacter(dying(), 4)
    const stabilized = updatedConditions.find(c => c.name === 'Stabilized')!
    expect(stabilized.mechanicalEffect).toContain('Cannot act')
    expect(stabilized.appliedAt).toBe(4)
  })

  it('leaves unrelated conditions alone', () => {
    const conditions = [...dying(), { id: 'b', name: 'Bleeding', category: 'Physical', description: 'x' }] as any[]
    const { updatedConditions } = stabilizeCharacter(conditions, 4)
    expect(updatedConditions.some(c => c.name === 'Bleeding')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Natural recovery — the design is "fiction and time", never a rest button
// ---------------------------------------------------------------------------
// In-game time previously did nothing at all: a character could carry a
// wound across in-game weeks and arrive exactly as hurt, because the only
// path down was the narrator explicitly reporting healing.

const bleeding = [{ id: 'b', name: 'Bleeding', category: 'Physical', description: 'x', harmPerScene: 1 }] as any[]

describe('accrueNaturalRecovery', () => {
  it('heals a point once enough in-game time has passed', () => {
    const r = accrueNaturalRecovery({ harm: 3, restHours: 0, hoursElapsed: HOURS_PER_HARM_RECOVERED })
    expect(r.healed).toBe(1)
    expect(r.newHarm).toBe(2)
  })

  it('CARRIES partial time instead of discarding it', () => {
    // Exchanges advance a handful of hours at a time. Rounding each one
    // down separately would mean nobody ever heals at all.
    const first = accrueNaturalRecovery({ harm: 3, restHours: 0, hoursElapsed: 6 })
    expect(first.healed).toBe(0)
    expect(first.restHours).toBe(6)

    const later = accrueNaturalRecovery({ harm: 3, restHours: 18, hoursElapsed: 6 })
    expect(later.healed).toBe(1)
  })

  it('keeps the remainder after healing rather than resetting it', () => {
    const r = accrueNaturalRecovery({ harm: 3, restHours: 0, hoursElapsed: HOURS_PER_HARM_RECOVERED + 5 })
    expect(r.healed).toBe(1)
    expect(r.restHours).toBe(5)
  })

  it('heals several points across a long stretch of time', () => {
    const r = accrueNaturalRecovery({ harm: 4, restHours: 0, hoursElapsed: HOURS_PER_HARM_RECOVERED * 3 })
    expect(r.healed).toBe(3)
    expect(r.newHarm).toBe(1)
  })

  it('never heals past unhurt', () => {
    const r = accrueNaturalRecovery({ harm: 1, restHours: 0, hoursElapsed: HOURS_PER_HARM_RECOVERED * 10 })
    expect(r.newHarm).toBe(0)
    expect(r.healed).toBe(1)
  })

  it('does nothing for a character who is Taken Out', () => {
    // At harm 6 the way back is stabilization and a narrated recovery roll,
    // not the calendar quietly undoing it — the mirror of the rule
    // recurring harm follows in the other direction.
    const r = accrueNaturalRecovery({ harm: 6, restHours: 0, hoursElapsed: HOURS_PER_HARM_RECOVERED * 5 })
    expect(r.healed).toBe(0)
    expect(r.newHarm).toBe(6)
  })

  it('does nothing for an uninjured character', () => {
    expect(accrueNaturalRecovery({ harm: 0, restHours: 0, hoursElapsed: 999 }).healed).toBe(0)
  })

  it('does not heal a wound that is still open', () => {
    // Bleeding costs harm every scene AND blocks mending. You do not
    // slowly recover from something still bleeding.
    const r = accrueNaturalRecovery({ harm: 3, restHours: 0, hoursElapsed: HOURS_PER_HARM_RECOVERED * 3, conditions: bleeding })
    expect(r.healed).toBe(0)
  })

  it('survives malformed inputs rather than propagating them', () => {
    const r = accrueNaturalRecovery({ harm: NaN as any, restHours: NaN as any, hoursElapsed: NaN as any })
    expect(r.healed).toBe(0)
    expect(Number.isFinite(r.restHours)).toBe(true)
  })
})

describe('blocksNaturalRecovery', () => {
  it('blocks on any condition dealing recurring harm, by effect not by name', () => {
    // Matched on the enforced field so a condition the fiction invents
    // blocks recovery too, without needing to be in the catalogue.
    expect(blocksNaturalRecovery(bleeding)).toBe(true)
    expect(blocksNaturalRecovery([{ name: 'Festering Curse', harmPerScene: 2 } as any])).toBe(true)
  })

  it('does not block on conditions that merely penalize rolls', () => {
    expect(blocksNaturalRecovery([{ name: 'Stunned', rollModifier: -1 } as any])).toBe(false)
    expect(blocksNaturalRecovery([])).toBe(false)
    expect(blocksNaturalRecovery(null)).toBe(false)
  })
})

describe('applyRest — the fiction half of recovery', () => {
  // Rest is narrated, never chosen: the AI reports the shelter the story
  // gave a character, and the engine decides what it was worth. These
  // cover the properties that keep that from becoming a loophole.

  it('grades recovery by the shelter the fiction gave them', () => {
    expect(applyRest(4, 'excellent').newHarm).toBe(2)
    expect(applyRest(4, 'adequate').newHarm).toBe(3)
    expect(applyRest(4, 'poor').newHarm).toBe(4)
  })

  it('says so plainly when the shelter was too rough to help', () => {
    const r = applyRest(3, 'poor')
    expect(r.newHarm).toBe(3)
    expect(r.message).toMatch(/insufficient/i)
  })

  it('will not mend a wound that is still open', () => {
    // The load-bearing one. accrueNaturalRecovery already refuses to heal
    // through bleeding; without this, "they slept at the inn" would be a
    // way around the rule the calendar path enforces.
    const r = applyRest(4, 'excellent', bleeding)
    expect(r.newHarm).toBe(4)
    expect(r.message).toMatch(/open/i)
  })

  it('blocks on recurring harm by effect, not by condition name', () => {
    expect(applyRest(4, 'excellent', [{ name: 'Festering Curse', harmPerScene: 1 } as any]).newHarm).toBe(4)
  })

  it('is unblocked by conditions that only penalize rolls', () => {
    expect(applyRest(4, 'excellent', [{ name: 'Stunned', rollModifier: -1 } as any]).newHarm).toBe(2)
  })

  it('cannot pull anyone back from Taken Out', () => {
    // At harm 6 the way back is stabilization and a recovery roll — a
    // narrated moment. Sleeping it off is not one.
    const r = applyRest(6, 'excellent')
    expect(r.newHarm).toBe(6)
    expect(r.message).toMatch(/stabiliz/i)
  })

  it('never heals past unhurt', () => {
    expect(applyRest(1, 'excellent').newHarm).toBe(0)
    expect(applyRest(0, 'excellent').newHarm).toBe(0)
  })

  it('is slower than a healer and faster than the calendar', () => {
    // The reason it exists as a third speed rather than an alias of one
    // of the other two.
    const bestRest = 4 - applyRest(4, 'excellent').newHarm
    expect(bestRest).toBeLessThan(3)  // expert + supplies heals 3
    expect(bestRest).toBeGreaterThan(0)
  })
})

describe('parseHarmState — the one place Character.conditions is read', () => {
  // This blob was parsed ad hoc at six sites, once per field, each one
  // independently responsible for remembering the column is nullable and
  // which fields live in it. restHours is what that cost: added for
  // natural recovery, and only two of the six knew it existed.

  it('reads every field of a well-formed blob', () => {
    expect(parseHarmState({
      conditions: [{ name: 'Bleeding' }],
      permanentInjuries: [{ name: 'Bad Leg' }],
      deathSaves: 2,
      restHours: 13,
    })).toEqual({
      conditions: [{ name: 'Bleeding' }],
      permanentInjuries: [{ name: 'Bad Leg' }],
      deathSaves: 2,
      restHours: 13,
    })
  })

  it('gives a complete default state for a character who has never been hurt', () => {
    // The nullable column, which is most rows.
    expect(parseHarmState(null)).toEqual(createDefaultHarmState())
    expect(parseHarmState(undefined)).toEqual(createDefaultHarmState())
  })

  it('survives the shapes a JSON column can actually hold', () => {
    for (const junk of ['nope', 42, [], true]) {
      expect(parseHarmState(junk), String(junk)).toEqual(createDefaultHarmState())
    }
  })

  it('degrades field by field rather than all-or-nothing', () => {
    // A corrupt deathSaves should cost the death saves, not a character's
    // entire condition list.
    const state = parseHarmState({
      conditions: [{ name: 'Stunned' }],
      deathSaves: 'two',
      restHours: -5,
      permanentInjuries: 'none',
    })
    expect(state.conditions).toEqual([{ name: 'Stunned' }])
    expect(state.deathSaves).toBe(0)
    expect(state.restHours).toBe(0)
    expect(state.permanentInjuries).toEqual([])
  })

  it('does not read a zero out of a missing field', () => {
    // Number(null) is 0 and finite — the coercion trap that has to be
    // rejected before it happens, not after.
    expect(parseHarmState({ deathSaves: null, restHours: null }))
      .toEqual(createDefaultHarmState())
  })
})

describe('validateHarmState', () => {
  it('accepts a state this codebase actually persists', () => {
    // It used to require a currentHarm between 0 and 6 — a field this blob
    // has never held, since harm is its own column. It returned false for
    // every row ever written, and nothing called it, so nothing noticed.
    expect(validateHarmState(createDefaultHarmState())).toBe(true)
    expect(validateHarmState(parseHarmState({ conditions: [], deathSaves: 1, restHours: 4, permanentInjuries: [] }))).toBe(true)
  })

  it('rejects the malformed blobs parseHarmState repairs', () => {
    // The split is deliberate: parse repairs because production reads
    // through it; validate reports whether a repair was needed.
    expect(validateHarmState(null)).toBe(false)
    expect(validateHarmState({ conditions: [] })).toBe(false)
    expect(validateHarmState({ conditions: 'x', deathSaves: 0, restHours: 0, permanentInjuries: [] })).toBe(false)
    expect(validateHarmState({ conditions: [], deathSaves: -1, restHours: 0, permanentInjuries: [] })).toBe(false)
  })

  it('agrees with parseHarmState: anything parsed is valid', () => {
    for (const junk of [null, 'x', 42, [], { conditions: 'no' }, { deathSaves: NaN }]) {
      expect(validateHarmState(parseHarmState(junk)), String(junk)).toBe(true)
    }
  })
})
