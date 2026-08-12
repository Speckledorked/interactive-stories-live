// src/lib/game/__tests__/economy.test.ts
import { describe, it, expect } from 'vitest'
import { clampGoldDelta, applyGoldDelta, MAX_GOLD_DELTA_MAGNITUDE } from '../economy'

describe('clampGoldDelta', () => {
  it('passes a reasonable delta through unchanged', () => {
    expect(clampGoldDelta(200)).toBe(200)
    expect(clampGoldDelta(-50)).toBe(-50)
  })

  it('maps missing/non-finite input to 0', () => {
    expect(clampGoldDelta(null)).toBe(0)
    expect(clampGoldDelta(undefined)).toBe(0)
    expect(clampGoldDelta(NaN)).toBe(0)
    expect(clampGoldDelta(Infinity)).toBe(0)
    expect(clampGoldDelta(-Infinity)).toBe(0)
  })

  it('clamps a hallucinated magnitude to the cap in both directions', () => {
    expect(clampGoldDelta(99_999_999)).toBe(MAX_GOLD_DELTA_MAGNITUDE)
    expect(clampGoldDelta(-99_999_999)).toBe(-MAX_GOLD_DELTA_MAGNITUDE)
  })

  it('truncates a fractional delta', () => {
    expect(clampGoldDelta(12.9)).toBe(12)
    expect(clampGoldDelta(-12.9)).toBe(-12)
  })
})

// #223: the negative-gold guarantee used to be a Math.max(0, current +
// clampGoldDelta(delta)) pattern duplicated at every balance-mutation call
// site — a convention every caller had to remember, not something
// clampGoldDelta itself enforced. applyGoldDelta is the single place that
// guarantee now lives, structurally.
describe('applyGoldDelta', () => {
  it('adds a positive delta to the current balance', () => {
    expect(applyGoldDelta(100, 50)).toBe(150)
  })

  it('subtracts a negative delta from the current balance', () => {
    expect(applyGoldDelta(100, -30)).toBe(70)
  })

  it('floors the resulting balance at 0 rather than going negative', () => {
    expect(applyGoldDelta(10, -50)).toBe(0)
    expect(applyGoldDelta(0, -1)).toBe(0)
  })

  it('treats a missing/non-finite current balance as 0', () => {
    expect(applyGoldDelta(null, 50)).toBe(50)
    expect(applyGoldDelta(undefined, 50)).toBe(50)
    expect(applyGoldDelta(NaN, 50)).toBe(50)
  })

  it('still clamps a hallucinated delta magnitude before applying it', () => {
    expect(applyGoldDelta(0, 99_999_999)).toBe(MAX_GOLD_DELTA_MAGNITUDE)
  })

  it('maps a missing/non-finite delta to a no-op', () => {
    expect(applyGoldDelta(100, null)).toBe(100)
    expect(applyGoldDelta(100, undefined)).toBe(100)
    expect(applyGoldDelta(100, NaN)).toBe(100)
  })

  it('a negative current balance combined with a positive delta still floors correctly', () => {
    // Guards against a caller ever passing a pre-corrupted negative
    // balance in — the floor applies to the RESULT, not just the input.
    expect(applyGoldDelta(-20, 5)).toBe(0)
  })
})
