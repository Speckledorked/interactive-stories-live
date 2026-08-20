// src/lib/game/__tests__/advancementTrackOutcome.test.ts
//
// A failed generation must not be reported as a fact about the universe.
//
// `parseAdvancementTrack` returns null for three different situations and
// only one of them is good news: the model deliberately said this world has
// no ladder (the prompt calls that a correct, expected answer), the field
// never arrived, or the field arrived malformed. The admin backfill used to
// report all three as "no advancement track — this universe has no rank
// ladder (that's a valid outcome)."
//
// So an operator clicking the button could be told, confidently, a fact
// about their world that nobody had established — and would have no reason
// to retry. That is the same trap the missing write at campaign creation sat
// in: null is MEANINGFUL for this column, so every null needs a provenance
// or the reassuring reading wins by default.

import { describe, it, expect } from 'vitest'
import { classifyAdvancementTrack, parseAdvancementTrack } from '../advancementTrack'

const usable = {
  tiers: [
    { key: 'unranked', label: 'Unranked' },
    { key: 'iron', label: 'Iron' },
  ],
  slot_groups: [{ key: 'essence', label: 'Essences', capacity: 4, domain: 'essence' }],
}

describe('classifyAdvancementTrack', () => {
  it('reports a usable track as generated', () => {
    expect(parseAdvancementTrack(usable)).not.toBeNull()
    expect(classifyAdvancementTrack(usable)).toBe('generated')
  })

  it('treats an explicit null as the model declining, which the prompt invites', () => {
    // "If it has neither, return null for advancement_track. Returning null
    // is a correct, expected answer."
    expect(classifyAdvancementTrack(null)).toBe('declined')
  })

  it('treats both arrays present and empty as declining too', () => {
    // The prompt's other documented way to say "neither".
    expect(classifyAdvancementTrack({ tiers: [], slot_groups: [] })).toBe('declined')
    expect(classifyAdvancementTrack({ tiers: [], slotGroups: [] })).toBe('declined')
  })

  it('treats a MISSING field as unusable, not as declining', () => {
    // This is the distinction the whole type exists for. `undefined` means
    // the key never arrived — the model did not answer the question, which
    // is not the same as answering "none".
    expect(classifyAdvancementTrack(undefined)).toBe('unusable')
  })

  it('treats malformed content as unusable', () => {
    expect(classifyAdvancementTrack('a ladder, sort of')).toBe('unusable')
    expect(classifyAdvancementTrack(42)).toBe('unusable')
    expect(classifyAdvancementTrack({ tiers: 'iron, bronze' })).toBe('unusable')
  })

  it('treats content too thin to render as unusable, not as declining', () => {
    // One rung is not a ladder and there are no slots, so nothing renders —
    // but the model clearly TRIED to describe a progression, so reporting
    // "this universe has no ranks" would be actively wrong.
    const oneRung = { tiers: [{ key: 'iron', label: 'Iron' }], slot_groups: [] }
    expect(parseAdvancementTrack(oneRung)).toBeNull()
    expect(classifyAdvancementTrack(oneRung)).toBe('unusable')
  })

  it('never reports generated for something that does not parse', () => {
    // The invariant tying the two functions together: the classification can
    // never claim success the parser did not produce.
    for (const raw of [null, undefined, {}, 42, 'x', { tiers: [] }, { tiers: [{ key: 'a', label: 'A' }] }]) {
      if (classifyAdvancementTrack(raw) === 'generated') {
        expect(parseAdvancementTrack(raw)).not.toBeNull()
      }
    }
    expect(classifyAdvancementTrack({})).not.toBe('generated')
  })
})
