// src/lib/game/__tests__/economy.test.ts
import { describe, it, expect } from 'vitest'
import { clampGoldDelta, MAX_GOLD_DELTA_MAGNITUDE } from '../economy'

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
