// src/lib/game/clockInvariant.ts
//
// What a valid clock looks like, in one place, because two paths need to
// agree on it and currently only one of them knows.
//
// The tick path assumes the invariant everywhere without ever asserting it:
// clockTick.ts selects advanceable clocks with `currentTicks: { lt: maxTicks }`
// and clamps with `Math.min(current + n, maxTicks)`, and the completion
// sweep reads `currentTicks >= maxTicks` as "just finished". Every one of
// those readings is sound only while `0 <= currentTicks <= maxTicks` and
// `maxTicks >= 1` hold.
//
// The admin PATCH route wrote client-supplied `currentTicks`/`maxTicks`
// straight through with no checks at all (#480), so a campaign admin could
// produce clocks none of those readings describes:
//
//   maxTicks 0      — `currentTicks >= maxTicks` is true immediately and
//                     progress is a division by zero in the UI.
//   maxTicks < 0    — permanently complete, can never be advanced.
//   current < 0     — renders as negative progress; the clamp never
//                     recovers it because advancement is additive.
//   current > max   — invisible to BOTH the `lt` advance query and, once
//                     resolvedAt is set, to the completion sweep: a clock
//                     that is neither running nor finishable.
//
// An admin is a trusted role, which is an argument for a clear error rather
// than an argument for no check — these are all reachable by a typo in a
// number field, and none of them announces itself.

/** The parsed, known-good tick pair. */
export interface ClockTicks {
  currentTicks?: number
  maxTicks?: number
}

export type ClockTicksResult =
  | { ok: true; value: ClockTicks }
  | { ok: false; error: string }

function isWholeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
}

/**
 * Validate a partial tick update against the existing clock.
 *
 * Partial on purpose: PATCH may carry either field, both, or neither, and
 * the `currentTicks <= maxTicks` invariant has to be checked against the
 * values the row will END UP with — checking the incoming pair alone would
 * pass `{ currentTicks: 9 }` against a stored `maxTicks: 4`.
 */
export function validateClockTicks(
  // The whole request body, not a pre-picked pair: the route hands this the
  // parsed JSON as it arrived, so the type has to tolerate the other fields
  // (name, description, gmNotes...) travelling alongside. Narrowing it to
  // exactly two keys would force every call site to destructure first, and
  // a call site that destructures is a call site that can forget a field.
  input: { currentTicks?: unknown; maxTicks?: unknown; [key: string]: unknown },
  existing: { currentTicks: number; maxTicks: number }
): ClockTicksResult {
  const value: ClockTicks = {}

  if (input.maxTicks !== undefined) {
    if (!isWholeNumber(input.maxTicks)) {
      return { ok: false, error: 'maxTicks must be a whole number' }
    }
    if (input.maxTicks < 1) {
      return { ok: false, error: 'maxTicks must be at least 1' }
    }
    value.maxTicks = input.maxTicks
  }

  if (input.currentTicks !== undefined) {
    if (!isWholeNumber(input.currentTicks)) {
      return { ok: false, error: 'currentTicks must be a whole number' }
    }
    if (input.currentTicks < 0) {
      return { ok: false, error: 'currentTicks cannot be negative' }
    }
    value.currentTicks = input.currentTicks
  }

  const resultingMax = value.maxTicks ?? existing.maxTicks
  const resultingCurrent = value.currentTicks ?? existing.currentTicks

  if (resultingCurrent > resultingMax) {
    return {
      ok: false,
      error: `currentTicks (${resultingCurrent}) cannot exceed maxTicks (${resultingMax})`,
    }
  }

  return { ok: true, value }
}
