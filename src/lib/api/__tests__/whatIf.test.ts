// src/lib/api/__tests__/whatIf.test.ts
// #427: the pure half of the admin what-if layer.

import { describe, it, expect } from 'vitest'
import { applyWhatIf, isWhatIf, STAT_BAND, type WhatIfSpec } from '../whatIf'

const SPEC: WhatIfSpec = { resources: STAT_BAND, stability: STAT_BAND }
const params = (q: string) => new URLSearchParams(q)

describe('applyWhatIf (#427)', () => {
  const faction = { id: 'f1', name: 'The Rustwatch', resources: 40, stability: 55, goal: 'expand' }

  it('returns the snapshot untouched when nothing was asked', () => {
    const result = applyWhatIf(faction, params(''), SPEC)

    expect(result.snapshot).toEqual(faction)
    expect(result.overridden).toEqual([])
    expect(result.rejected).toEqual([])
    expect(isWhatIf(result)).toBe(false)
  })

  it('overlays only the fields the route opened', () => {
    const result = applyWhatIf(faction, params('resources=80'), SPEC)

    expect(result.snapshot.resources).toBe(80)
    expect(result.snapshot.stability).toBe(55)
    expect(result.overridden).toEqual(['resources'])
    expect(isWhatIf(result)).toBe(true)
  })

  it('never mutates the caller’s snapshot', () => {
    // The real object is the campaign's live state, read moments earlier.
    // Mutating it in place is how a "read-only" preview stops being one.
    const original = { ...faction }
    applyWhatIf(faction, params('resources=80&stability=10'), SPEC)

    expect(faction).toEqual(original)
  })

  it('ignores a field the route did not open', () => {
    // Not an error: query strings carry unrelated params (cache busters,
    // UI state). Silently not applying them is right; silently APPLYING
    // them would let a caller perturb a field the decision never models.
    const result = applyWhatIf(faction, params('goal=conquer&resources=70'), SPEC)

    expect(result.snapshot.goal).toBe('expand')
    expect(result.overridden).toEqual(['resources'])
  })

  it('rejects an out-of-range value instead of clamping it', () => {
    // Clamping would answer a question nobody asked: type 150, get the
    // reasoning for 100, with nothing saying so. That is worse than an
    // error because it looks like an answer.
    const result = applyWhatIf(faction, params('resources=150'), SPEC)

    expect(result.snapshot.resources).toBe(40)
    expect(result.overridden).toEqual([])
    expect(result.rejected).toEqual(['resources: 150 is outside 0–100'])
  })

  it('rejects a negative value the column could never hold', () => {
    const result = applyWhatIf(faction, params('stability=-5'), SPEC)

    expect(result.snapshot.stability).toBe(55)
    expect(result.rejected).toHaveLength(1)
  })

  it('rejects a non-numeric value by name', () => {
    const result = applyWhatIf(faction, params('resources=lots'), SPEC)

    expect(result.rejected).toEqual(['resources: "lots" is not a number'])
    expect(result.snapshot.resources).toBe(40)
  })

  it('accepts both ends of the band', () => {
    expect(applyWhatIf(faction, params('resources=0'), SPEC).snapshot.resources).toBe(0)
    expect(applyWhatIf(faction, params('resources=100'), SPEC).snapshot.resources).toBe(100)
  })

  it('truncates a fractional value rather than passing a float into integer math', () => {
    // These feed decide* functions that band and compare integers; a float
    // would work by accident and diverge from what the real tick could ever
    // see, since the column is an Int.
    expect(applyWhatIf(faction, params('resources=42.9'), SPEC).snapshot.resources).toBe(42)
  })

  it('applies several overrides at once and reports them sorted', () => {
    const result = applyWhatIf(faction, params('stability=10&resources=90'), SPEC)

    expect(result.snapshot).toMatchObject({ resources: 90, stability: 10 })
    expect(result.overridden).toEqual(['resources', 'stability'])
  })
})
