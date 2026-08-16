// src/lib/game/tick/__tests__/tickGoldenVectors.test.ts
// #398: the simulation's magnitudes are the simulation's behaviour.
//
// The mutation audit found 8 of 15 mutations surviving a green suite, and
// they cluster in one place: the tick's tests assert DIRECTION AND BOUNDS
// ("military decreases", "roughness < 0.3", "attacker is favored"), while
// resolution.goldenVectors.test.ts asserts VALUES. Direction-and-bounds is
// the right discipline for a property you want to keep flexible — but
// ATTRITION_MILITARY is not an implementation detail behind a "military
// decreases" contract. The number IS the contract: it decides how long a
// war lasts, which decides whether a clock beats it, which decides what
// the campaign is about.
//
// So: ×10 the attrition constants and every assertion still held. 0.3 → 0.5
// on the absorption rate, still green. HIGH_BAND_MIN anywhere in 51..80,
// still green, silently retuning war declaration and ambition resourcing.
//
// This file is the resolution.goldenVectors discipline carried across that
// boundary. Each case pins an exact output for an exact input, so changing
// a constant fails a test that NAMES THE NUMBER — which is the point: a
// rebalance should be a deliberate act with a visible diff, not a
// side-effect nobody notices.

import { describe, it, expect } from 'vitest'
import { band, MEDIUM_BAND_MIN, HIGH_BAND_MIN, decideFactionCollapse } from '../factionTick'
import { decideWarProgress } from '../warTick'
import { decideSuccession } from '../leadershipTick'
import { decideDistortion } from '../informationTick'

describe('band() — the LOW/MEDIUM/HIGH cutoffs (#398)', () => {
  // Mutation #5: HIGH_BAND_MIN could be moved anywhere in 51..80 and the
  // whole suite stayed green, because no test called band() directly —
  // while warTick's declaration threshold and ambitionTick's resourcing
  // gate both read it.
  it.each([
    [0, 'LOW'],
    [33, 'LOW'],
    [34, 'MEDIUM'],
    [66, 'MEDIUM'],
    [67, 'HIGH'],
    [100, 'HIGH'],
  ])('band(%i) is %s', (value, expected) => {
    expect(band(value)).toBe(expected)
  })

  it('pins both cutoffs themselves', () => {
    // Named explicitly so a rebalance has to change a test that states the
    // numbers, rather than sliding through on relational assertions.
    expect(MEDIUM_BAND_MIN).toBe(34)
    expect(HIGH_BAND_MIN).toBe(67)
    expect(band(MEDIUM_BAND_MIN - 1)).toBe('LOW')
    expect(band(MEDIUM_BAND_MIN)).toBe('MEDIUM')
    expect(band(HIGH_BAND_MIN - 1)).toBe('MEDIUM')
    expect(band(HIGH_BAND_MIN)).toBe('HIGH')
  })
})

describe('decideFactionCollapse — exact transfers (#398)', () => {
  // Mutation #3: ABSORPTION_TRANSFER_RATE 0.3 → 0.5 survived, because
  // every assertion in the existing tests is relational or a loose bound.
  it('transfers exactly the base rate on the smoothest possible collapse', () => {
    // stability exactly at the threshold is roughness 0 — the smoothest
    // collapse this function can produce.
    const smooth = decideFactionCollapse({ stability: 10, resources: 100, military: 100 })

    expect(smooth.collapses).toBe(true)
    expect(smooth.roughness).toBe(0)
    // The base absorption rate, pinned as a value. Mutation #3 moved this
    // from 0.3 to 0.5 with the suite still green.
    expect(smooth.transferResources).toBe(30)
    expect(smooth.transferMilitary).toBe(30)
  })

  it('scatters more of what is left as the collapse gets rougher', () => {
    const rough = decideFactionCollapse({ stability: 0, resources: 100, military: 100 })

    expect(rough.transferResources).toBe(15)
    expect(rough.roughness).toBe(1)
  })

  it('does not collapse a faction above the threshold at all', () => {
    expect(decideFactionCollapse({ stability: 11, resources: 100, military: 100 })).toEqual({
      collapses: false,
      transferResources: 0,
      transferMilitary: 0,
      roughness: 0,
    })
  })
})

describe('decideWarProgress — exact attrition (#398)', () => {
  // Mutation #4: ATTRITION_RESOURCES/ATTRITION_MILITARY could be multiplied
  // by TEN and the suite stayed green, because the existing assertions are
  // `toBeLessThan(0)` on four deltas. Ten times the attrition is a
  // completely different game — wars that used to grind for a dozen turns
  // resolve in one.
  it('costs both sides exactly the attrition constants per turn', () => {
    const progress = decideWarProgress(
      { id: 'w1' },
      { military: 60 },
      { military: 60 },
      5
    )

    expect(progress.attackerResourceDelta).toBe(-3)
    expect(progress.attackerMilitaryDelta).toBe(-2)
    expect(progress.defenderResourceDelta).toBe(-3)
    expect(progress.defenderMilitaryDelta).toBe(-2)
  })
})

describe('decideSuccession — exact roughness (#398)', () => {
  // Mutation #7: computeSuccessionRoughness could be reweighted freely,
  // because the only assertions were `< 0.3`, `contested > uncontested`,
  // and 0..1 bounds. Roughness feeds the wake system, so its magnitude
  // decides how long a leadership change destabilises a faction.
  const member = (id: string, importance: number) => ({ id, name: id, importance, factionRole: 'MEMBER' as const })

  it('is exactly half the instability when nobody contests', () => {
    const decision = decideSuccession({
      name: 'The Rustwatch',
      leaderCharacterId: null,
      stability: 60,
      members: [member('heir', 5), member('nobody', 1)],
    })

    // contestFraction 0 (the other member is 4 below the heir, outside the
    // contest gap), instability (100-60)/100 = 0.4 → (0 + 0.4) / 2.
    expect(decision?.successionRoughness).toBe(0.2)
  })

  it('is exactly the midpoint when every other member is a rival', () => {
    const decision = decideSuccession({
      name: 'The Rustwatch',
      leaderCharacterId: null,
      stability: 60,
      members: [member('heir', 5), member('rival', 5)],
    })

    // contestFraction 1, instability 0.4 → (1 + 0.4) / 2.
    expect(decision?.successionRoughness).toBeCloseTo(0.7, 10)
  })
})

describe('decideDistortion — more hops means MORE distortion (#398)', () => {
  // Mutation #6, the worst finding in the audit: SWAPPING the short- and
  // long-delay distortion percentages left the suite green, because
  // informationTick.test.ts asserts only `sawDifference === true` — a
  // predicate that is SYMMETRIC under the swap. The feature's entire
  // premise (news degrades as it travels) inverts and nothing notices.
  //
  // This is the directional invariant, stated as a property rather than as
  // "these two cases differ": across a large sample of ids, a long delay
  // must distort strictly more often than a short one.
  const sampleDistortionRate = (delay: number): number => {
    const SAMPLE = 400
    let distorted = 0
    for (let i = 0; i < SAMPLE; i++) {
      if (decideDistortion(`event-${i}`, `witness-${i}`, 1, delay).distorted) distorted++
    }
    return distorted / SAMPLE
  }

  it('distorts strictly more at a long delay than a short one', () => {
    const short = sampleDistortionRate(1)
    const long = sampleDistortionRate(30)

    expect(long).toBeGreaterThan(short)
  })

  it('pins both rates, so a swap or a retune fails a test that names the number', () => {
    // Hash-derived, so these are close to but not exactly the configured
    // percentages — the bound is deliberately tight enough that a swap
    // (15 <-> 45) or a meaningful retune breaks it.
    expect(sampleDistortionRate(1)).toBeGreaterThan(0.05)
    expect(sampleDistortionRate(1)).toBeLessThan(0.25)
    expect(sampleDistortionRate(30)).toBeGreaterThan(0.35)
    expect(sampleDistortionRate(30)).toBeLessThan(0.55)
  })

  it('treats the threshold itself as short, and one turn past it as long', () => {
    // Mutation-adjacent: the binary cliff at delay 3->4 is real behaviour,
    // so it should be pinned rather than discovered.
    expect(sampleDistortionRate(3)).toBeLessThan(0.25)
    expect(sampleDistortionRate(4)).toBeGreaterThan(0.35)
  })
})
