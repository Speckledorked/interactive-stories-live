// src/lib/analytics/__tests__/events.test.ts
// Retention math: DN-retention definition, cohort aggregation, and the
// eligibility guard that keeps a fresh cohort from showing a misleading 0%.

import { describe, it, expect } from 'vitest'
import {
  isRetainedOnDay,
  countRetainedOnDay,
  computeCohortRetention,
  UserActivity,
} from '../events'

const DAY = 86_400_000

describe('isRetainedOnDay', () => {
  const signup = new Date('2026-01-01T09:00:00Z')

  it('true when activity falls on exactly calendar day N after signup', () => {
    const activity = [new Date('2026-01-08T14:00:00Z')] // day 7, different hour
    expect(isRetainedOnDay(signup, activity, 7)).toBe(true)
  })

  it('false when activity is one day early or late', () => {
    expect(isRetainedOnDay(signup, [new Date('2026-01-07T09:00:00Z')], 7)).toBe(false) // day 6
    expect(isRetainedOnDay(signup, [new Date('2026-01-09T09:00:00Z')], 7)).toBe(false) // day 8
  })

  it('false with no activity at all', () => {
    expect(isRetainedOnDay(signup, [], 1)).toBe(false)
  })

  it('checks all activity dates, not just the first', () => {
    // signup is 09:00 UTC; day-7 window is [Jan 8 09:00, Jan 9 09:00) —
    // the first date misses it, the second lands inside it.
    const activity = [new Date('2026-01-02T00:00:00Z'), new Date('2026-01-08T12:00:00Z')]
    expect(isRetainedOnDay(signup, activity, 7)).toBe(true)
  })
})

describe('countRetainedOnDay', () => {
  it('counts only users retained on that day', () => {
    const signup = new Date('2026-01-01T00:00:00Z')
    const users: UserActivity[] = [
      { userId: 'a', signupAt: signup, activityDates: [new Date(signup.getTime() + DAY)] },
      { userId: 'b', signupAt: signup, activityDates: [] },
      { userId: 'c', signupAt: signup, activityDates: [new Date(signup.getTime() + DAY)] },
    ]
    expect(countRetainedOnDay(users, 1)).toBe(2)
  })
})

describe('computeCohortRetention', () => {
  const weekStart = new Date('2026-01-05T00:00:00Z') // a Monday

  it('reports eligible windows with real retained counts', () => {
    const now = new Date(weekStart.getTime() + 40 * DAY).getTime() // well past D28
    const users: UserActivity[] = [
      { userId: 'a', signupAt: weekStart, activityDates: [new Date(weekStart.getTime() + DAY)] },
      { userId: 'b', signupAt: weekStart, activityDates: [] },
    ]
    const result = computeCohortRetention(weekStart, users, now)
    expect(result.cohortSize).toBe(2)
    expect(result.d1).toEqual({ retained: 1, eligible: true })
    expect(result.d7.eligible).toBe(true)
    expect(result.d28.eligible).toBe(true)
  })

  it('marks D7/D28 ineligible (pending) for a cohort too young to measure them', () => {
    const now = new Date(weekStart.getTime() + 2 * DAY).getTime() // only 2 days old
    const users: UserActivity[] = [{ userId: 'a', signupAt: weekStart, activityDates: [] }]
    const result = computeCohortRetention(weekStart, users, now)
    expect(result.d1.eligible).toBe(true)
    expect(result.d7.eligible).toBe(false)
    expect(result.d28.eligible).toBe(false)
  })

  it('handles an empty cohort', () => {
    const result = computeCohortRetention(weekStart, [], weekStart.getTime() + 40 * DAY)
    expect(result.cohortSize).toBe(0)
    expect(result.d1.retained).toBe(0)
  })
})
