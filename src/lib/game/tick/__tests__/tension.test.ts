// src/lib/game/tick/__tests__/tension.test.ts
// #420: the tension model had no tests.
//
// The audit read tension.ts as "191 lines of nuance collapsed to one bit",
// counting only the mechanical consumer. The count is off — describeTension
// (five bands) and derivePhase (four phases) both reach the narrator on
// every scene, so the resolution IS used — but the finding underneath it is
// exactly right and worse than stated: a weighted sum, read as five bands
// and four phases, with NOTHING pinning where any boundary falls or what
// any input contributes.
//
// That is the one shape where a silent retune does maximum damage. Move
// clockPressure's weight and a campaign never leaves 'simmering'; the
// prompt says "calm" through a war, the phase never reaches 'climax', and
// tensionClockBonus never fires. Every one of those is invisible — no
// crash, no failing assertion, just a pacing model that quietly stopped.
//
// So: golden vectors, in the resolution.goldenVectors discipline. Each case
// pins an exact number for an exact input, and each boundary is named.

import { describe, it, expect } from 'vitest'
import {
  computeTension,
  derivePhase,
  tensionClockBonus,
  describeTension,
  TENSION_BASELINE,
  TENSION_MIN,
  TENSION_MAX,
  type TensionInputs,
} from '../tension'

const QUIET: TensionInputs = {
  clockFillRatios: [],
  activeWarCount: 0,
  partyHarm: [],
  factionThreatLevels: [],
}

const inputs = (over: Partial<TensionInputs>): TensionInputs => ({ ...QUIET, ...over })

describe('computeTension — the baseline (#420)', () => {
  it('sits exactly at the baseline when nothing is happening', () => {
    expect(computeTension(QUIET)).toBe(TENSION_BASELINE)
  })

  it('never leaves the 0..100 range even when everything is maxed', () => {
    const maxed = computeTension({
      clockFillRatios: [1, 1, 1, 1],
      activeWarCount: 99,
      partyHarm: [6, 6, 6, 6],
      factionThreatLevels: [5, 5],
    })

    expect(maxed).toBeLessThanOrEqual(TENSION_MAX)
    expect(maxed).toBeGreaterThanOrEqual(TENSION_MIN)
    // And it does reach the top — a model that can't produce its own
    // maximum has a dead band at the end that nothing would notice.
    expect(maxed).toBe(TENSION_MAX)
  })
})

describe('computeTension — each input, pinned in isolation (#420)', () => {
  // Isolating each term is what makes a reweighting fail a test that names
  // the term, rather than one aggregate number that could move for any of
  // four reasons.

  it('weights a single full clock at exactly 40 over baseline', () => {
    // maxFill 1 * 0.7 + avgFill 1 * 0.3 = 1, times the 40-point budget.
    expect(computeTension(inputs({ clockFillRatios: [1] }))).toBe(TENSION_BASELINE + 40)
  })

  it('weights the nearest-to-firing clock far above the mean', () => {
    // One full clock among three empty ones: maxFill 1, avgFill 1/4.
    // (1 * 0.7 + 0.25 * 0.3) * 40 = 31. The whole point of the weighting is
    // that this is much closer to 40 than to the 10 a plain mean gives.
    expect(computeTension(inputs({ clockFillRatios: [1, 0, 0, 0] }))).toBe(TENSION_BASELINE + 31)
  })

  it('saturates war pressure at three simultaneous wars', () => {
    expect(computeTension(inputs({ activeWarCount: 1 }))).toBe(TENSION_BASELINE + 8)
    expect(computeTension(inputs({ activeWarCount: 3 }))).toBe(TENSION_BASELINE + 24)
    // A fourth war adds nothing — the saturation is the design.
    expect(computeTension(inputs({ activeWarCount: 4 }))).toBe(TENSION_BASELINE + 24)
    expect(computeTension(inputs({ activeWarCount: 40 }))).toBe(TENSION_BASELINE + 24)
  })

  it('weights a fully harmed party at exactly 20 over baseline', () => {
    expect(computeTension(inputs({ partyHarm: [6, 6] }))).toBe(TENSION_BASELINE + 20)
    // Averaged, not summed: a big party does not read as a tenser one.
    expect(computeTension(inputs({ partyHarm: [6, 0] }))).toBe(TENSION_BASELINE + 10)
  })

  it('weights standing threat least, and only via the most dangerous faction', () => {
    expect(computeTension(inputs({ factionThreatLevels: [5] }))).toBe(TENSION_BASELINE + 12)
    // Max, not mean — one monster on the board is the signal.
    expect(computeTension(inputs({ factionThreatLevels: [5, 1, 1] }))).toBe(TENSION_BASELINE + 12)
    // And it is the weakest term: a maxed threat contributes less than a
    // single war, which contributes less than one nearly-full clock.
    expect(computeTension(inputs({ factionThreatLevels: [5] }))).toBeLessThan(
      computeTension(inputs({ clockFillRatios: [1] }))
    )
  })

  it('ignores clocks and harm lists that are empty rather than dividing by zero', () => {
    expect(computeTension(inputs({ clockFillRatios: [], partyHarm: [] }))).toBe(TENSION_BASELINE)
  })
})

describe('describeTension — the five bands, at their exact boundaries (#420)', () => {
  it.each([
    [0, 'calm'],
    [24, 'calm'],
    [25, 'simmering'],
    [39, 'simmering'],
    [40, 'building'],
    [59, 'building'],
    [60, 'high'],
    [74, 'high'],
    [75, 'breaking point'],
    [100, 'breaking point'],
  ])('describeTension(%i) is %s', (tension, expected) => {
    expect(describeTension(tension)).toBe(expected)
  })

  it('reaches every band from real inputs, not just from hand-picked numbers', () => {
    // A band the model cannot actually produce is a band the narrator never
    // sees — the failure mode a boundary test alone would miss.
    const reachable = new Set([
      describeTension(computeTension(QUIET)),
      describeTension(computeTension(inputs({ clockFillRatios: [0.5] }))),
      describeTension(computeTension(inputs({ clockFillRatios: [1], activeWarCount: 1 }))),
      describeTension(
        computeTension({
          clockFillRatios: [1, 1],
          activeWarCount: 2,
          partyHarm: [4],
          factionThreatLevels: [4],
        })
      ),
    ])

    expect(reachable).toContain('simmering')
    expect(reachable).toContain('building')
    expect(reachable).toContain('high')
    expect(reachable).toContain('breaking point')
  })
})

describe('derivePhase — the four phases (#420)', () => {
  it('is climax at and above 75 regardless of how far along the campaign is', () => {
    expect(derivePhase(75, 1)).toBe('climax')
    expect(derivePhase(100, 500)).toBe('climax')
  })

  it('is rising from 45 up to the climax threshold', () => {
    expect(derivePhase(45, 1)).toBe('rising')
    expect(derivePhase(74, 500)).toBe('rising')
    expect(derivePhase(44, 1)).not.toBe('rising')
  })

  it('splits the quiet by position in the campaign, not by tension', () => {
    // The design claim: a lull twenty scenes in reads differently from the
    // opening, so the same tension gives a different phase.
    expect(derivePhase(20, 10)).toBe('setup')
    expect(derivePhase(20, 11)).toBe('aftermath')
  })
})

describe('tensionClockBonus — the one mechanical bit (#420)', () => {
  it('fires only at the breaking point, and only by one tick', () => {
    expect(tensionClockBonus(74)).toBe(0)
    expect(tensionClockBonus(75)).toBe(1)
    expect(tensionClockBonus(100)).toBe(1)
  })

  it('shares its threshold with climax and "breaking point"', () => {
    // Three thresholds at 75, in three files, none of them referencing a
    // shared constant. Pinned together so a retune of one shows up as a
    // disagreement rather than a silent divergence.
    expect(tensionClockBonus(75)).toBe(1)
    expect(derivePhase(75, 1)).toBe('climax')
    expect(describeTension(75)).toBe('breaking point')
  })
})
