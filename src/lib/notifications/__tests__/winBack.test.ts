// src/lib/notifications/__tests__/winBack.test.ts
//
// #506 — the four rules that keep a win-back letter from being spam.
//
// This is the only mail MythOS sends to someone who is NOT using it, which
// makes every one of these a product decision rather than an
// implementation detail. Each test names the way the feature goes wrong
// without the rule it covers.

import { describe, it, expect } from 'vitest'
import {
  decideWinBack,
  describeAbsence,
  daysBetween,
  LAPSE_AFTER_DAYS,
  ABANDON_AFTER_DAYS,
  MIN_DAYS_BETWEEN_SENDS,
  MAX_WIN_BACKS,
  type WinBackCandidate,
} from '../winBack'

const NOW = new Date('2026-10-01T12:00:00Z')
const DAY = 24 * 60 * 60 * 1000

/** `days` ago. */
function ago(days: number): Date {
  return new Date(NOW.getTime() - days * DAY)
}

/** An eligible member — every test below spoils exactly one thing. */
function eligible(overrides: Partial<WinBackCandidate> = {}): WinBackCandidate {
  return {
    lastViewedAt: ago(LAPSE_AFTER_DAYS + 3),
    winBackSentAt: null,
    winBackCount: 0,
    hasNewActivity: true,
    emailsAllowed: true,
    ...overrides,
  }
}

describe('the baseline', () => {
  it('writes to someone genuinely away from a world that genuinely moved', () => {
    // Without this passing, every refusal below could be the decider simply
    // never saying yes.
    const decision = decideWinBack(eligible(), NOW)
    expect(decision.send).toBe(true)
    expect(decision).toMatchObject({ daysAway: LAPSE_AFTER_DAYS + 3 })
  })
})

describe('rule 1 — something actually happened', () => {
  it('stays silent when the world did not move', () => {
    // "We miss you" with nothing behind it is a growth email. The claim
    // this letter makes is that something happened; if nothing did, there
    // is no letter to write.
    const decision = decideWinBack(eligible({ hasNewActivity: false }), NOW)
    expect(decision).toEqual({ send: false, reason: 'nothing-happened' })
  })
})

describe('rule 2 — they are actually gone', () => {
  it('leaves someone alone over a long weekend', () => {
    const decision = decideWinBack(eligible({ lastViewedAt: ago(LAPSE_AFTER_DAYS - 1) }), NOW)
    expect(decision).toEqual({ send: false, reason: 'still-active' })
  })

  it('writes on the day the lapse window is reached, not a day later', () => {
    const decision = decideWinBack(eligible({ lastViewedAt: ago(LAPSE_AFTER_DAYS) }), NOW)
    expect(decision.send).toBe(true)
  })

  it('never writes to someone who has not opened the campaign at all', () => {
    // No checkpoint to diff against, so no absence to recap. They are an
    // onboarding problem and this is the wrong letter.
    const decision = decideWinBack(eligible({ lastViewedAt: null }), NOW)
    expect(decision).toEqual({ send: false, reason: 'never-visited' })
  })
})

describe('rule 3 — they are not gone for good', () => {
  it('stops chasing someone past the abandonment ceiling', () => {
    const decision = decideWinBack(eligible({ lastViewedAt: ago(ABANDON_AFTER_DAYS + 1) }), NOW)
    expect(decision).toEqual({ send: false, reason: 'abandoned' })
  })

  it('still writes on the last day inside the ceiling', () => {
    const decision = decideWinBack(eligible({ lastViewedAt: ago(ABANDON_AFTER_DAYS) }), NOW)
    expect(decision.send).toBe(true)
  })
})

describe('rule 4 — not again too soon, and not forever', () => {
  it('waits out the cooldown after a recent letter', () => {
    const decision = decideWinBack(
      eligible({ winBackSentAt: ago(MIN_DAYS_BETWEEN_SENDS - 1), winBackCount: 1 }),
      NOW
    )
    expect(decision).toEqual({ send: false, reason: 'cooling-down' })
  })

  it('writes again once the cooldown has elapsed', () => {
    const decision = decideWinBack(
      eligible({ winBackSentAt: ago(MIN_DAYS_BETWEEN_SENDS), winBackCount: 1 }),
      NOW
    )
    expect(decision.send).toBe(true)
  })

  it('gives up for good at the lifetime cap', () => {
    // Three unanswered letters is an answer.
    const decision = decideWinBack(
      eligible({ winBackCount: MAX_WIN_BACKS, winBackSentAt: ago(365) }),
      NOW
    )
    expect(decision).toEqual({ send: false, reason: 'cap-reached' })
  })
})

describe('the switches', () => {
  it('refuses before anything else when the user has turned these off', () => {
    // Checked first so a user who opted out is never evaluated further —
    // and so the reason reported is the honest one.
    const decision = decideWinBack(
      eligible({ emailsAllowed: false, lastViewedAt: null, hasNewActivity: false }),
      NOW
    )
    expect(decision).toEqual({ send: false, reason: 'emails-off' })
  })
})

describe('describeAbsence', () => {
  it('counts days only while the number is small enough to mean something', () => {
    expect(describeAbsence(9)).toBe('9 days')
  })

  it('goes vague rather than counting at someone', () => {
    // A letter that says "you have been gone for 47 days" reads as a system
    // keeping score, which is the wrong voice for this one message.
    expect(describeAbsence(16)).toBe('a couple of weeks')
    expect(describeAbsence(25)).toBe('a few weeks')
    expect(describeAbsence(47)).toBe('a while')
  })
})

describe('daysBetween', () => {
  it('floors, so "7 days away" means seven whole days have passed', () => {
    expect(daysBetween(new Date(NOW.getTime() - 7 * DAY + 1000), NOW)).toBe(6)
    expect(daysBetween(new Date(NOW.getTime() - 7 * DAY), NOW)).toBe(7)
  })
})
