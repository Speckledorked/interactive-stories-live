// src/lib/game/__tests__/economy.test.ts
import { describe, it, expect } from 'vitest'
import { clampGoldDelta, applyGoldDelta, spendGold, MAX_GOLD_DELTA_MAGNITUDE } from '../economy'

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

// ---------------------------------------------------------------------------
// spendGold — the refusal applyGoldDelta could not express.
//
// applyGoldDelta floors at 0, which is right for a credit and was quietly
// wrong for a purchase: spending 200 with 50 in hand produced a balance of 0
// and let the purchase stand. Nobody could ever fail to afford anything —
// only be drained — so "I can't cover this" never became a reason to bargain,
// borrow, lie or steal.
// ---------------------------------------------------------------------------
describe('spendGold', () => {
  it('REFUSES a purchase the character cannot cover, and takes nothing', () => {
    // The whole point. The old behaviour was gold: 0 and the purchase stands.
    const out = spendGold(50, -200)

    expect(out.refused).toBe(true)
    expect(out.spent).toBe(0)
    expect(out.gold).toBe(50)
    expect(out.shortfall).toBe(150)
  })

  it('does not partially pay — half a purchase is not a state the fiction can hold', () => {
    expect(spendGold(199, -200).spent).toBe(0)
    expect(spendGold(199, -200).gold).toBe(199)
  })

  it('allows a spend the character can exactly cover', () => {
    const out = spendGold(200, -200)
    expect(out.refused).toBe(false)
    expect(out.spent).toBe(200)
    expect(out.gold).toBe(0)
    expect(out.shortfall).toBe(0)
  })

  it('reads the cost as an amount, so sign at the call site cannot flip the meaning', () => {
    expect(spendGold(100, -30)).toEqual(spendGold(100, 30))
  })

  it('treats a zero or missing cost as a no-op rather than a refusal', () => {
    for (const cost of [0, null, undefined, NaN]) {
      const out = spendGold(100, cost as number)
      expect(out.refused, String(cost)).toBe(false)
      expect(out.gold, String(cost)).toBe(100)
      expect(out.spent, String(cost)).toBe(0)
    }
  })

  it('never returns a negative balance from junk input', () => {
    expect(spendGold(-20, -5).gold).toBe(0)
    expect(spendGold(NaN, -5).gold).toBe(0)
    expect(spendGold(null, -5).refused).toBe(true)
  })

  it('still respects the magnitude guardrail', () => {
    // A hallucinated cost is clamped before it can decide affordability.
    expect(spendGold(MAX_GOLD_DELTA_MAGNITUDE, -99_999_999).refused).toBe(false)
  })

  it('leaves applyGoldDelta alone — a REWARD must not start refusing', () => {
    // Rewards, quest payouts and downtime returns all still credit through
    // applyGoldDelta. Changing that function instead of adding this one would
    // have made every credit path affordability-checked, which is nonsense.
    expect(applyGoldDelta(10, -50)).toBe(0)
    expect(applyGoldDelta(10, 50)).toBe(60)
  })
})
