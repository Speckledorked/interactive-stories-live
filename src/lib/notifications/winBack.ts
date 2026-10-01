// src/lib/notifications/winBack.ts
//
// #506 — the one piece of the retention loop that never reached outward.
//
// MythOS already builds everything a lapsed player would want to hear: the
// world keeps turning on the daily sweep, the absence journal reconstructs
// what changed since they last looked, and the lobby shows it the moment
// they return. All of it waits for them to come back on their own. Nothing
// goes and tells them there is something to come back TO.
//
// The decision is pure and lives here so the rules are readable in one
// place and testable without a mail server or a database. Four of them, and
// each exists to stop a specific way this feature turns into spam:
//
//   1. SOMETHING HAPPENED. No send unless the world actually moved since
//      they last looked. "We miss you" with nothing behind it is a growth
//      email; "your world moved without you" is only true if it did.
//   2. THEY ARE ACTUALLY GONE. A few days is a weekend, not a lapse.
//   3. THEY ARE NOT GONE FOR GOOD. Past the ceiling they have left, and
//      mail to someone who left months ago is addressed to a decision they
//      already made.
//   4. NOT AGAIN TOO SOON, AND NOT FOREVER. A cooldown between sends and a
//      hard lifetime cap per seat. Three unanswered letters is an answer.
//
// What the email SAYS is not decided here. It reuses the absence journal's
// own fog-gated renderer, so the mail can only contain what the in-app
// recap would have shown that same player — an undiscovered faction cannot
// leak into an inbox, because the thing building the sentences never sees
// it. A second, independently-written copy surface is exactly how that goes
// wrong, so there isn't one.

/** A weekend away is not a lapse. */
export const LAPSE_AFTER_DAYS = 7

/**
 * Past this, they have left rather than lapsed. Chasing someone two months
 * gone is mail addressed to a decision they already made.
 */
export const ABANDON_AFTER_DAYS = 60

/** Minimum gap between win-backs for the same seat. */
export const MIN_DAYS_BETWEEN_SENDS = 14

/** Lifetime cap per seat. Three unanswered letters is an answer. */
export const MAX_WIN_BACKS = 3

const DAY_MS = 24 * 60 * 60 * 1000

/** One member's state, as the sweep reads it. */
export interface WinBackCandidate {
  /** Last lobby load. Null means they have never opened this campaign. */
  lastViewedAt: Date | null
  /** When the last win-back for this seat went out, if any. */
  winBackSentAt: Date | null
  /** How many have gone out for this seat. */
  winBackCount: number
  /** Whether the world produced anything since `lastViewedAt`. */
  hasNewActivity: boolean
  /** Both the global email switch and this user's win-back switch. */
  emailsAllowed: boolean
}

export type WinBackDecision =
  | { send: true; daysAway: number }
  | { send: false; reason: WinBackSkipReason }

export type WinBackSkipReason =
  | 'emails-off'
  | 'never-visited'
  | 'still-active'
  | 'abandoned'
  | 'nothing-happened'
  | 'cooling-down'
  | 'cap-reached'

/**
 * Whole numbers of days between two instants, floored — so "7 days away"
 * means seven full days have passed, not six and a half rounded up.
 */
export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS)
}

/**
 * Pure. Order matters: the cheapest and most absolute refusals come first,
 * so a user who has switched these off is never evaluated further, and the
 * reason returned is the most honest one rather than whichever rule
 * happened to be checked first.
 */
export function decideWinBack(candidate: WinBackCandidate, now: Date): WinBackDecision {
  if (!candidate.emailsAllowed) return { send: false, reason: 'emails-off' }

  // Someone who has never opened the campaign has no absence to recap and
  // no checkpoint to diff against. They are a different problem (onboarding)
  // and this is the wrong letter to send them.
  if (!candidate.lastViewedAt) return { send: false, reason: 'never-visited' }

  if (candidate.winBackCount >= MAX_WIN_BACKS) return { send: false, reason: 'cap-reached' }

  const daysAway = daysBetween(candidate.lastViewedAt, now)
  if (daysAway < LAPSE_AFTER_DAYS) return { send: false, reason: 'still-active' }
  if (daysAway > ABANDON_AFTER_DAYS) return { send: false, reason: 'abandoned' }

  // Checked after the window rather than before it because it is the
  // expensive one — the sweep only has to ask the database what happened
  // for members who are otherwise already eligible.
  if (!candidate.hasNewActivity) return { send: false, reason: 'nothing-happened' }

  if (candidate.winBackSentAt) {
    const sinceLastSend = daysBetween(candidate.winBackSentAt, now)
    if (sinceLastSend < MIN_DAYS_BETWEEN_SENDS) return { send: false, reason: 'cooling-down' }
  }

  return { send: true, daysAway }
}

/**
 * "three weeks" / "nine days" — the absence as prose, for the subject line.
 *
 * Deliberately vague above a month: a letter that tells someone exactly how
 * many days they have been gone reads as a system counting, which is the
 * wrong voice for the one message MythOS sends to someone not using it.
 */
export function describeAbsence(days: number): string {
  if (days < 14) return `${days} days`
  if (days < 21) return 'a couple of weeks'
  if (days < 31) return 'a few weeks'
  return 'a while'
}
