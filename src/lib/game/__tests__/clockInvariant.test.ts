// src/lib/game/__tests__/clockInvariant.test.ts
//
// #480: the clock PATCH route wrote client ticks straight into the database.
// Each case below is a clock the tick engine cannot describe — see
// clockInvariant.ts for what each one breaks.

import { describe, it, expect } from 'vitest'
import { validateClockTicks } from '../clockInvariant'

const EXISTING = { currentTicks: 2, maxTicks: 4 }

describe('validateClockTicks', () => {
  it('accepts a normal update', () => {
    const result = validateClockTicks({ currentTicks: 3, maxTicks: 6 }, EXISTING)
    expect(result).toEqual({ ok: true, value: { currentTicks: 3, maxTicks: 6 } })
  })

  it('leaves out fields that were not sent, so Prisma leaves those columns alone', () => {
    const result = validateClockTicks({ name: 'renamed' }, EXISTING)
    expect(result.ok).toBe(true)
    if (result.ok) expect(Object.keys(result.value)).toEqual([])
  })

  it('rejects fractional ticks', () => {
    expect(validateClockTicks({ currentTicks: 1.5 }, EXISTING).ok).toBe(false)
    expect(validateClockTicks({ maxTicks: 4.5 }, EXISTING).ok).toBe(false)
  })

  it('rejects non-numbers', () => {
    // The route hands us a parsed JSON body, so a string is one typo away.
    expect(validateClockTicks({ currentTicks: '3' }, EXISTING).ok).toBe(false)
    expect(validateClockTicks({ maxTicks: null }, EXISTING).ok).toBe(false)
  })

  it('rejects negative currentTicks', () => {
    expect(validateClockTicks({ currentTicks: -1 }, EXISTING).ok).toBe(false)
  })

  it('rejects maxTicks below 1', () => {
    // 0 makes `currentTicks >= maxTicks` true on a brand-new clock and
    // turns any progress display into a division by zero.
    expect(validateClockTicks({ maxTicks: 0 }, EXISTING).ok).toBe(false)
    expect(validateClockTicks({ maxTicks: -4 }, EXISTING).ok).toBe(false)
  })

  it('rejects currentTicks above maxTicks when both are sent', () => {
    expect(validateClockTicks({ currentTicks: 9, maxTicks: 4 }, EXISTING).ok).toBe(false)
  })

  it('checks the invariant against the RESULTING row, not the payload alone', () => {
    // The case a payload-only check misses in both directions.
    expect(validateClockTicks({ currentTicks: 9 }, EXISTING).ok).toBe(false)
    expect(validateClockTicks({ maxTicks: 1 }, { currentTicks: 4, maxTicks: 8 }).ok).toBe(false)
    // ...and the case it would wrongly reject: raising max to fit the new current.
    expect(validateClockTicks({ currentTicks: 6, maxTicks: 8 }, EXISTING).ok).toBe(true)
  })

  it('allows a clock sitting exactly at completion', () => {
    // `currentTicks === maxTicks` is how the engine spells "finished".
    expect(validateClockTicks({ currentTicks: 4, maxTicks: 4 }, EXISTING).ok).toBe(true)
  })
})
