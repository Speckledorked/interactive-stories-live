// src/lib/downtime/__tests__/downtimeEventOutcome.test.ts
// Deterministic downtime day-event outcomes — replaces the bare
// Math.random() < 0.4 coin flip and fully-freeform AI event nature with a
// reproducible, riskLevel-weighted roll (see the module's own doc comment).

import { describe, it, expect } from 'vitest'
import {
  decideDowntimeDayEvent,
  decideDowntimeOutcomeCategory,
  describeOutcomeConstraint,
  DowntimeEventOutcome,
} from '../downtimeEventOutcome'

const ALL_OUTCOMES: DowntimeEventOutcome[] = ['setback', 'complication', 'smooth', 'opportunity']

describe('decideDowntimeDayEvent', () => {
  it('is deterministic — same inputs always produce the same decision', () => {
    const a = decideDowntimeDayEvent('activity-1', 5, 'medium')
    const b = decideDowntimeDayEvent('activity-1', 5, 'medium')
    expect(a).toEqual(b)
  })

  it('only ever returns a valid outcome category when an event happens', () => {
    for (let day = 0; day < 50; day++) {
      const decision = decideDowntimeDayEvent('activity-sweep', day, 'medium')
      if (decision.hasEvent) {
        expect(ALL_OUTCOMES).toContain(decision.outcome)
      } else {
        expect(decision.outcome).toBeNull()
      }
    }
  })

  it('produces a mix of event/no-event days over a long sweep, roughly matching the historical ~40% rate', () => {
    let eventDays = 0
    const totalDays = 200
    for (let day = 0; day < totalDays; day++) {
      if (decideDowntimeDayEvent('activity-rate-check', day, 'medium').hasEvent) eventDays++
    }
    const rate = eventDays / totalDays
    expect(rate).toBeGreaterThan(0.25)
    expect(rate).toBeLessThan(0.55)
  })

  it('produces different schedules for different activities (not globally identical)', () => {
    const a = Array.from({ length: 20 }, (_, day) => decideDowntimeDayEvent('activity-a', day, 'medium').hasEvent)
    const b = Array.from({ length: 20 }, (_, day) => decideDowntimeDayEvent('activity-b', day, 'medium').hasEvent)
    expect(a).not.toEqual(b)
  })

  it('treats an unrecognized or missing risk level as medium', () => {
    const unspecified = decideDowntimeDayEvent('activity-risk', 7, undefined)
    const explicitMedium = decideDowntimeDayEvent('activity-risk', 7, 'medium')
    expect(unspecified).toEqual(explicitMedium)

    const garbage = decideDowntimeDayEvent('activity-risk', 7, 'extreme')
    expect(garbage).toEqual(explicitMedium)
  })
})

describe('decideDowntimeOutcomeCategory', () => {
  it('is deterministic and always returns one of the four categories', () => {
    for (let day = 0; day < 30; day++) {
      const outcome = decideDowntimeOutcomeCategory('activity-cat', day, 'high')
      expect(ALL_OUTCOMES).toContain(outcome)
      expect(decideDowntimeOutcomeCategory('activity-cat', day, 'high')).toBe(outcome)
    }
  })

  it('skews high-risk activities toward setback/complication more than low-risk', () => {
    const tally = (risk: 'low' | 'high') => {
      const counts: Record<DowntimeEventOutcome, number> = { setback: 0, complication: 0, smooth: 0, opportunity: 0 }
      for (let day = 0; day < 300; day++) {
        counts[decideDowntimeOutcomeCategory(`activity-${risk}`, day, risk)]++
      }
      return counts
    }
    const low = tally('low')
    const high = tally('high')
    const badRate = (c: Record<DowntimeEventOutcome, number>) => (c.setback + c.complication) / 300

    expect(badRate(high)).toBeGreaterThan(badRate(low))
  })
})

describe('describeOutcomeConstraint', () => {
  it('gives a distinct, unambiguous instruction for every category', () => {
    const descriptions = ALL_OUTCOMES.map(describeOutcomeConstraint)
    expect(new Set(descriptions).size).toBe(ALL_OUTCOMES.length)
    for (const outcome of ALL_OUTCOMES) {
      expect(describeOutcomeConstraint(outcome).toLowerCase()).toContain(outcome === 'complication' ? 'complication' : outcome)
    }
  })
})
