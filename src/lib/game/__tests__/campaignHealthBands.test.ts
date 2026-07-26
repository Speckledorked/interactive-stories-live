// src/lib/game/__tests__/campaignHealthBands.test.ts
//
// "Is this campaign in trouble" had three answers and agreed with itself
// in none of them: `isHealthy` on the monitor (>= 70 and no issues), an
// async checkCampaignNeedsIntervention that nothing called (< 50 or 3+
// issues), and the admin panel's own colour thresholds (>= 70 / >= 40)
// invented locally. A GM could read an amber badge on a campaign the
// engine considered to need intervention.

import { describe, it, expect } from 'vitest'
import {
  needsIntervention,
  healthBand,
  HEALTH_INTERVENTION_SCORE,
  HEALTH_INTERVENTION_ISSUE_COUNT,
  HEALTH_GOOD_SCORE,
} from '../campaignHealthBands'

const issues = (n: number) => Array.from({ length: n }, (_, i) => `issue ${i}`)

describe('needsIntervention', () => {
  it('fires on a low score even with nothing specific flagged', () => {
    expect(needsIntervention({ score: HEALTH_INTERVENTION_SCORE - 1, issues: [] })).toBe(true)
  })

  it('does not fire at the threshold itself', () => {
    expect(needsIntervention({ score: HEALTH_INTERVENTION_SCORE, issues: [] })).toBe(false)
  })

  it('fires on many issues even at a perfectly acceptable score', () => {
    // The half a single average would smooth away: a campaign sitting at
    // 80 with three separate things wrong is not a healthy campaign.
    expect(needsIntervention({ score: 80, issues: issues(HEALTH_INTERVENTION_ISSUE_COUNT) })).toBe(true)
  })

  it('tolerates a couple of rough edges at a good score', () => {
    expect(needsIntervention({ score: 80, issues: issues(HEALTH_INTERVENTION_ISSUE_COUNT - 1) })).toBe(false)
  })

  it('does not treat a never-assessed campaign as a crisis', () => {
    // The coercion trap: Number(null) is 0 and finite, which would make
    // "not measured yet" read as the worst possible health. Every campaign
    // under five scenes is in this state.
    expect(needsIntervention({ score: null, issues: [] })).toBe(false)
    expect(needsIntervention(null)).toBe(false)
    expect(needsIntervention(undefined)).toBe(false)
  })

  it('still reports trouble for an unscored campaign with real issues', () => {
    expect(needsIntervention({ score: null, issues: issues(4) })).toBe(true)
  })

  it('survives malformed persisted values rather than propagating them', () => {
    expect(needsIntervention({ score: NaN, issues: [] })).toBe(false)
    expect(needsIntervention({ score: 'bad' as unknown as number, issues: [] })).toBe(false)
    expect(needsIntervention({ score: 10, issues: 'nope' as unknown as string[] })).toBe(true)
  })
})

describe('healthBand', () => {
  it('is good only at a high score with nothing flagged', () => {
    expect(healthBand({ score: HEALTH_GOOD_SCORE, issues: [] })).toBe('good')
    expect(healthBand({ score: HEALTH_GOOD_SCORE, issues: issues(1) })).toBe('fair')
    expect(healthBand({ score: HEALTH_GOOD_SCORE - 1, issues: [] })).toBe('fair')
  })

  it('is needs-intervention exactly when needsIntervention says so', () => {
    // The property that keeps a badge from disagreeing with the verdict
    // printed next to it.
    const cases = [
      { score: 10, issues: [] },
      { score: 90, issues: issues(5) },
      { score: 65, issues: issues(1) },
      { score: null, issues: [] },
      { score: 100, issues: [] },
      { score: HEALTH_INTERVENTION_SCORE, issues: [] },
    ]
    for (const c of cases) {
      expect(healthBand(c) === 'needs-intervention', JSON.stringify(c)).toBe(needsIntervention(c))
    }
  })

  it('shows an unassessed campaign as fair, not as failing', () => {
    expect(healthBand({ score: null, issues: [] })).toBe('fair')
    expect(healthBand(null)).toBe('fair')
  })

  it('never returns a band outside the three the UI can colour', () => {
    for (const score of [null, NaN, -50, 0, 49, 50, 69, 70, 100, 1e9]) {
      expect(['good', 'fair', 'needs-intervention']).toContain(
        healthBand({ score: score as number | null, issues: [] })
      )
    }
  })
})
