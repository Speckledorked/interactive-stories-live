// src/lib/game/__tests__/corruptionGates.test.ts
//
// Corruption as a real content gate (#83).
//
// The gating arithmetic is simple; what these actually pin down is the
// safety property that makes gating a track of IRREVERSIBLE marks
// survivable — an ungated default, an off switch tied to the campaign
// theme, and clamping that degrades rather than throws. The
// boundary-only rule (entry, acquisition, leverage — never retroactive)
// lives at the call sites, and is covered where those are tested.

import { describe, it, expect } from 'vitest'
import {
  checkCorruptionGate,
  isImpossibleGate,
  hasCorruptionGate,
  describeRefusal,
} from '../corruptionGates'
import { MAX_CORRUPTION } from '../corruption'

describe('checkCorruptionGate', () => {
  it('lets everyone through an ungated entity', () => {
    // Every row in every existing campaign. Gating is opt-in per row, so
    // shipping this changed nothing that already existed.
    for (const marks of [0, 1, 3, 5]) {
      expect(checkCorruptionGate({}, marks, true).allowed).toBe(true)
      expect(checkCorruptionGate({ minCorruption: null, maxCorruption: null }, marks, true).allowed).toBe(true)
    }
  })

  it('refuses the insufficiently marked from a min gate', () => {
    const shrine = { minCorruption: 3 }
    expect(checkCorruptionGate(shrine, 2, true)).toEqual({ allowed: false, refusal: 'too_clean' })
    expect(checkCorruptionGate(shrine, 3, true).allowed).toBe(true)
    expect(checkCorruptionGate(shrine, 5, true).allowed).toBe(true)
  })

  it('refuses the over-marked from a max gate', () => {
    const temple = { maxCorruption: 2 }
    expect(checkCorruptionGate(temple, 3, true)).toEqual({ allowed: false, refusal: 'too_corrupt' })
    expect(checkCorruptionGate(temple, 2, true).allowed).toBe(true)
    expect(checkCorruptionGate(temple, 0, true).allowed).toBe(true)
  })

  it('honors a band with both bounds', () => {
    const band = { minCorruption: 2, maxCorruption: 4 }
    expect(checkCorruptionGate(band, 1, true).refusal).toBe('too_clean')
    expect(checkCorruptionGate(band, 3, true).allowed).toBe(true)
    expect(checkCorruptionGate(band, 5, true).refusal).toBe('too_corrupt')
  })

  it('is disabled entirely in a campaign with no corruption theme', () => {
    // A universe without a theme has no corruption, so a gate left on a
    // row by an import or a re-theme must not silently lock content —
    // matching how the rest of the track disables itself.
    expect(checkCorruptionGate({ minCorruption: 5 }, 0, false).allowed).toBe(true)
    expect(checkCorruptionGate({ maxCorruption: 0 }, 5, false).allowed).toBe(true)
  })

  it('handles a missing entity without throwing', () => {
    expect(checkCorruptionGate(null, 3, true).allowed).toBe(true)
    expect(checkCorruptionGate(undefined, 3, true).allowed).toBe(true)
  })

  it('clamps an out-of-range bound instead of rejecting the row', () => {
    // There is no CHECK constraint on the column on purpose: a bad value
    // must degrade, not fail a write mid-transaction and take a whole
    // scene resolution down.
    expect(checkCorruptionGate({ minCorruption: 99 }, MAX_CORRUPTION, true).allowed).toBe(true)
    expect(checkCorruptionGate({ maxCorruption: -5 }, 0, true).allowed).toBe(true)
  })

  it('treats a malformed bound as no bound at all', () => {
    expect(checkCorruptionGate({ minCorruption: NaN }, 0, true).allowed).toBe(true)
    expect(checkCorruptionGate({ minCorruption: 'three' as unknown as number }, 0, true).allowed).toBe(true)
  })

  it('treats malformed corruption as untouched rather than as anything', () => {
    // Erring toward "clean" is the safe direction: it can refuse entry to
    // a forbidden place, never grant it.
    expect(checkCorruptionGate({ minCorruption: 1 }, NaN, true).refusal).toBe('too_clean')
  })
})

describe('isImpossibleGate', () => {
  it('flags crossed bounds nobody could ever satisfy', () => {
    // Almost certainly an authoring mistake rather than an intentional
    // dead end, and worth surfacing rather than hiding content forever.
    expect(isImpossibleGate({ minCorruption: 4, maxCorruption: 2 })).toBe(true)
  })

  it('accepts a single-value band', () => {
    expect(isImpossibleGate({ minCorruption: 3, maxCorruption: 3 })).toBe(false)
  })

  it('is false for a one-sided or absent gate', () => {
    expect(isImpossibleGate({ minCorruption: 3 })).toBe(false)
    expect(isImpossibleGate({ maxCorruption: 3 })).toBe(false)
    expect(isImpossibleGate({})).toBe(false)
    expect(isImpossibleGate(null)).toBe(false)
  })
})

describe('hasCorruptionGate', () => {
  it('detects either bound', () => {
    expect(hasCorruptionGate({ minCorruption: 1 })).toBe(true)
    expect(hasCorruptionGate({ maxCorruption: 1 })).toBe(true)
    expect(hasCorruptionGate({})).toBe(false)
    expect(hasCorruptionGate({ minCorruption: null, maxCorruption: null })).toBe(false)
    expect(hasCorruptionGate(null)).toBe(false)
  })
})

describe('describeRefusal', () => {
  it('speaks in the theme’s own vocabulary, never in numbers', () => {
    const clean = describeRefusal('too_clean', 'the Rot')
    const corrupt = describeRefusal('too_corrupt', 'the Rot')
    for (const line of [clean, corrupt]) {
      expect(line).toContain('the Rot')
      expect(line).not.toMatch(/\d/)
      expect(line.toLowerCase()).not.toContain('corruption')
    }
    expect(clean).not.toBe(corrupt)
  })
})

// ---------------------------------------------------------------------------
// The leverage gate, as computeMechanics sees it
// ---------------------------------------------------------------------------
// The third enforcement point (#83). It's the one gate with no lasting
// state, which is exactly why an NPC is gated on leverage rather than on
// something durable: a repulsed NPC's rapport simply doesn't count while
// the gate applies, and counts again the moment it stops.

describe('the leverage gate has nothing to trap', () => {
  it('is a pure re-read of current state, so it reverses itself', () => {
    const contact = { maxCorruption: 2 }
    // Marked past the bar: no rapport.
    expect(checkCorruptionGate(contact, 3, true).allowed).toBe(false)
    // Same NPC, same call, after the fiction lifts the gate — allowed
    // again, with nothing to undo, because nothing was written.
    expect(checkCorruptionGate({ maxCorruption: 5 }, 3, true).allowed).toBe(true)
  })
})
