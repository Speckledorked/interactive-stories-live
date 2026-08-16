// src/components/character/__tests__/healthDisplay.test.tsx
//
// "Health" counts DOWN. Two surfaces got this backwards.
//
// CharacterSheetDisplay and CharacterSnapshotModal both labelled a field
// "Health" and then printed the raw harm value under it, so an untouched
// character read "Health 0/6" — the number stating the opposite of the
// word above it, in green. HarmTracker had it right all along
// (`Health: {remaining}/{max}`), which is exactly why the disagreement
// went unnoticed: whichever surface you looked at seemed self-consistent.
//
// These tests pin the DIRECTION rather than any particular markup, so a
// future refactor of either component still has to keep full health
// reading as full.

import { describe, it, expect } from 'vitest'
import { healthRemaining, HARM_STATUS_COLORS } from '../HarmTracker'
import { clampHarm, getHarmStatus, MAX_HARM } from '@/lib/game/harm'

describe('healthRemaining', () => {
  it('counts down from full: an unharmed character is at full health, not zero', () => {
    expect(healthRemaining(0)).toEqual({ remaining: MAX_HARM, max: MAX_HARM })
  })

  it('reaches zero only when the character is taken out', () => {
    expect(healthRemaining(MAX_HARM).remaining).toBe(0)
    expect(getHarmStatus(clampHarm(MAX_HARM)).status).toBe('Taken Out')
  })

  it('moves opposite to harm across the whole track', () => {
    for (let harm = 0; harm <= MAX_HARM; harm++) {
      expect(healthRemaining(harm).remaining).toBe(MAX_HARM - harm)
    }
  })

  it('clamps junk rather than rendering a negative or over-full bar', () => {
    expect(healthRemaining(99).remaining).toBe(0)
    expect(healthRemaining(-5).remaining).toBe(MAX_HARM)
    expect(healthRemaining(NaN).remaining).toBe(MAX_HARM)
  })
})

describe('HARM_STATUS_COLORS', () => {
  // The colours are keyed off getHarmStatus's own status strings. If a
  // band is ever renamed in the engine, this fails here rather than
  // silently falling through to a default ink colour on three screens.
  it('covers every status the engine can return', () => {
    const seen = new Set<string>()
    for (let harm = 0; harm <= MAX_HARM; harm++) {
      seen.add(getHarmStatus(clampHarm(harm)).status)
    }
    for (const status of seen) {
      expect(HARM_STATUS_COLORS[status], `no colour for status "${status}"`).toBeTruthy()
    }
  })
})
