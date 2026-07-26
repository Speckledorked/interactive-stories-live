// src/lib/game/__tests__/outcomeAdherence.test.ts
//
// Does the narration obey the roll? (#93)
//
// The engine rolled server-side, the prompt called the band BINDING, and
// nothing checked — the largest gap between what this product claims and
// what it enforces. A model could narrate a clean triumph on a MISS and the
// only artifact that disagreed was a receipt in a panel nobody opens.
//
// The check works by asking rather than inferring: the model reports which
// band its prose actually depicts, and that is compared to what was rolled.
// These cover the comparison, and especially the cases where the honest
// answer is "I can't tell" — because a check that manufactures false alarms
// is a check that gets switched off.

import { describe, it, expect } from 'vitest'
import { checkOutcomeAdherence, isOutcomeBand, OUTCOME_BANDS } from '../outcomeAdherence'

const rolled = (name: string, outcome: string) => ({ characterName: name, outcome: outcome as never })
const echo = (name: string, outcome: string) => ({ character_name_or_id: name, outcome })

describe('checkOutcomeAdherence', () => {
  it('accepts narration that reports the band that was rolled', () => {
    const r = checkOutcomeAdherence([rolled('Jason', 'miss')], [echo('Jason', 'miss')])
    expect(r.matched).toBe(1)
    expect(r.mismatched).toBe(0)
    expect(r.problems).toEqual([])
  })

  it('catches a triumph narrated on a miss', () => {
    // The failure the whole entry exists for.
    const r = checkOutcomeAdherence([rolled('Jason', 'miss')], [echo('Jason', 'strongHit')])
    expect(r.mismatched).toBe(1)
    expect(r.entries[0]).toMatchObject({ rolled: 'miss', narrated: 'strongHit', verdict: 'mismatch' })
    expect(r.problems[0]).toContain('Jason')
  })

  it('catches the subtler drift of a weak hit narrated as clean', () => {
    // Arguably the more common failure: a weak hit is a success WITH a
    // cost, and dropping the cost is easy to do without noticing.
    const r = checkOutcomeAdherence([rolled('Mira', 'weakHit')], [echo('Mira', 'strongHit')])
    expect(r.mismatched).toBe(1)
  })

  it('judges each character separately', () => {
    const r = checkOutcomeAdherence(
      [rolled('Jason', 'miss'), rolled('Mira', 'strongHit')],
      [echo('Jason', 'strongHit'), echo('Mira', 'strongHit')]
    )
    expect(r.matched).toBe(1)
    expect(r.mismatched).toBe(1)
  })

  it('matches names case- and whitespace-insensitively', () => {
    // The model echoes a name it read from the prompt; punishing it for
    // capitalisation would be a false alarm.
    const r = checkOutcomeAdherence([rolled('Jason', 'miss')], [echo('  jason ', 'miss')])
    expect(r.matched).toBe(1)
  })

  it('counts silence as unreported rather than as a contradiction', () => {
    // Failing to answer is not the same as contradicting, and conflating
    // them would make the mismatch count useless.
    const r = checkOutcomeAdherence([rolled('Jason', 'miss')], [])
    expect(r.mismatched).toBe(0)
    expect(r.unreported).toBe(1)
    expect(r.entries[0].verdict).toBe('unreported')
  })

  it('still surfaces silence, so omission is not a way to dodge the check', () => {
    const r = checkOutcomeAdherence([rolled('Jason', 'miss'), rolled('Mira', 'weakHit')], null)
    expect(r.unreported).toBe(2)
  })

  it('refuses to guess when one character had several rolled actions', () => {
    // A single name-keyed echo cannot say WHICH action it refers to.
    // Guessing would invent mismatches, and false alarms are how a check
    // earns its way onto the ignore list.
    const r = checkOutcomeAdherence(
      [rolled('Jason', 'miss'), rolled('Jason', 'strongHit')],
      [echo('Jason', 'miss')]
    )
    expect(r.ambiguous).toBe(2)
    expect(r.mismatched).toBe(0)
    expect(r.matched).toBe(0)
  })

  it('ignores an echo for someone who never rolled', () => {
    // A hallucinated line about a character with no rolled action says
    // nothing about adherence.
    const r = checkOutcomeAdherence([rolled('Jason', 'miss')], [echo('Nobody', 'strongHit'), echo('Jason', 'miss')])
    expect(r.matched).toBe(1)
    expect(r.entries).toHaveLength(1)
  })

  it('takes the first report when a model contradicts itself about one character', () => {
    // Letting a later line overwrite an earlier one would let a model
    // retract a mismatch by repeating itself.
    const r = checkOutcomeAdherence([rolled('Jason', 'miss')], [echo('Jason', 'strongHit'), echo('Jason', 'miss')])
    expect(r.mismatched).toBe(1)
  })

  it('is a clean no-op when nothing was rolled', () => {
    // Freeform scenes — dialogue, planning — have no bands to honor.
    const r = checkOutcomeAdherence([], [echo('Jason', 'strongHit')])
    expect(r).toMatchObject({ matched: 0, mismatched: 0, unreported: 0, ambiguous: 0 })
    expect(r.entries).toEqual([])
  })

  it('discards garbage instead of scoring it', () => {
    const r = checkOutcomeAdherence(
      [rolled('Jason', 'miss'), rolled('Ghost', 'nonsense')],
      [{ character_name_or_id: null, outcome: 'miss' }, { character_name_or_id: 'Jason', outcome: 'sideways' }]
    )
    // The bad rolled entry is dropped; Jason's bad echo is not a mismatch.
    expect(r.entries).toHaveLength(1)
    expect(r.mismatched).toBe(0)
    expect(r.unreported).toBe(1)
  })

  it('survives the shapes a malformed response can hold', () => {
    for (const junk of [null, undefined, 'text', 42, {}]) {
      expect(() => checkOutcomeAdherence([rolled('Jason', 'miss')], junk)).not.toThrow()
    }
    expect(checkOutcomeAdherence(null as never, null).entries).toEqual([])
  })

  it('never reports more entries than there were rolled actions', () => {
    // The invariant that keeps this a measurement of the engine's rolls
    // rather than of whatever the model chose to talk about.
    const r = checkOutcomeAdherence(
      [rolled('Jason', 'miss')],
      [echo('Jason', 'miss'), echo('A', 'miss'), echo('B', 'miss'), echo('C', 'miss')]
    )
    expect(r.entries).toHaveLength(1)
  })
})

describe('isOutcomeBand', () => {
  it('accepts exactly the three bands the engine produces', () => {
    for (const band of OUTCOME_BANDS) expect(isOutcomeBand(band)).toBe(true)
    for (const bad of ['STRONG HIT', 'hit', '', null, undefined, 1]) {
      expect(isOutcomeBand(bad), String(bad)).toBe(false)
    }
  })
})
