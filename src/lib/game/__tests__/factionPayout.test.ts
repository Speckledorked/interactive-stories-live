// src/lib/game/__tests__/factionPayout.test.ts
//
// The faction-wealth → player-wealth edge. Faction.resources was already
// read all over the simulation (ambition thresholds, goal drift, war
// outcomes, absorption transfer); what it never did was reach a player.
// These pin down the two properties that make a payout an economy rather
// than a number: it costs the payer, and a payer who can't afford it says
// so instead of conjuring gold.

import { describe, it, expect } from 'vitest'
import {
  assessPayout,
  isBroke,
  describeDefault,
  GOLD_PER_RESOURCE_POINT,
  MAX_RESOURCE_COST_PER_PAYOUT,
  BROKE_THRESHOLD,
} from '../factionPayout'

describe('assessPayout', () => {
  it('a healthy faction pays in full', () => {
    const a = assessPayout(200, 80)
    expect(a.paid).toBe(200)
    expect(a.shortfall).toBe(0)
    expect(a.defaulted).toBe(false)
  })

  it('charges the payer for what it paid', () => {
    // The whole point: gold no longer appears from nowhere.
    const a = assessPayout(300, 80)
    expect(a.resourceCost).toBe(3)
  })

  it('never lets a payout be free through rounding', () => {
    // Otherwise a faction could bankroll the party indefinitely in small
    // increments without the simulation ever noticing.
    const a = assessPayout(1, 80)
    expect(a.paid).toBe(1)
    expect(a.resourceCost).toBe(1)
  })

  it('a broke faction pays what it has and defaults on the rest', () => {
    // Partial rather than nothing: "they scraped together what they could"
    // is what being poor looks like. A faction stiffing the party entirely
    // is a beat the narrator should choose, not an arithmetic accident.
    const a = assessPayout(1000, 3)
    expect(a.paid).toBe(3 * GOLD_PER_RESOURCE_POINT)
    expect(a.shortfall).toBe(1000 - 300)
    expect(a.defaulted).toBe(true)
  })

  it('a destitute faction pays nothing at all', () => {
    const a = assessPayout(500, 0)
    expect(a.paid).toBe(0)
    expect(a.resourceCost).toBe(0)
    expect(a.defaulted).toBe(true)
  })

  it('caps what a single payout can cost, so one bad number cannot collapse a faction', () => {
    // clampGoldDelta's ceiling is 100,000. Without this cap that single
    // hallucinated grant would zero a faction's resources in one turn and
    // cascade straight into war outcomes and ambition thresholds.
    const a = assessPayout(100_000, 100)
    expect(a.resourceCost).toBe(MAX_RESOURCE_COST_PER_PAYOUT)
  })

  it('never charges a faction more than it actually has', () => {
    for (const resources of [0, 1, 5, 12]) {
      const a = assessPayout(100_000, resources)
      expect(a.resourceCost).toBeLessThanOrEqual(resources)
    }
  })

  it('is a no-op for a reward with no gold in it', () => {
    // Items-only and standing-only rewards must not silently tax a payer.
    expect(assessPayout(0, 50)).toEqual({
      promised: 0, paid: 0, shortfall: 0, resourceCost: 0, defaulted: false,
    })
  })

  it('treats a negative or malformed promise as nothing owed', () => {
    // A reward is a payout, never a debit.
    expect(assessPayout(-500, 50).paid).toBe(0)
    expect(assessPayout(NaN as unknown as number, 50).paid).toBe(0)
  })

  it('clamps a resources value outside the 0-100 band', () => {
    expect(assessPayout(50, 500).paid).toBe(50)
    expect(assessPayout(50, -20).paid).toBe(0)
  })

  it('never pays more than was promised, however rich the payer', () => {
    const a = assessPayout(10, 100)
    expect(a.paid).toBe(10)
    expect(a.shortfall).toBe(0)
  })
})

describe('isBroke', () => {
  it('flags a faction below the threshold', () => {
    expect(isBroke(BROKE_THRESHOLD - 1)).toBe(true)
    expect(isBroke(BROKE_THRESHOLD)).toBe(false)
    expect(isBroke(90)).toBe(false)
  })

  it('treats a malformed value as destitute rather than solvent', () => {
    expect(isBroke(NaN as unknown as number)).toBe(true)
  })
})

describe('describeDefault', () => {
  it('names the faction and both numbers', () => {
    const line = describeDefault('Merchants Guild', assessPayout(1000, 3))
    expect(line).toContain('Merchants Guild')
    expect(line).toContain('300')
    expect(line).toContain('1000')
  })
})
