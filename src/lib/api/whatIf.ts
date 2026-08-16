// src/lib/api/whatIf.ts
//
// #427: the editable half of the admin reasoning previews.
//
// Every world-entity admin tab already shows real reasoning, computed by
// the same pure `explain*` functions the live tick calls (#94/#126). That
// is genuinely good — the preview cannot drift from the tick, because
// there is one implementation and the preview is its explaining half.
//
// What an admin could not do is change an input and watch the output move.
// To answer "would this faction still go to war if its stability were ten
// points higher?" the only route was to edit the faction for real, run a
// turn, and undo it — against live campaign state, with the tick's writes
// already committed. A read-only projection tells you what the engine DID.
// An editable one tells you what the engine IS, which is the difference
// between a log and a model, and legibility is the whole argument this
// project rests on.
//
// ── Why this is small ─────────────────────────────────────────────────────
//
// The pieces were already in place. Every `explain*` function is pure and
// takes a snapshot rather than a database handle — precisely the signature
// a what-if needs. So the override is: parse a patch, merge it into the
// snapshot before it goes in, run the same function, write nothing.
//
// ── Why GET and query params, not POST and a body ─────────────────────────
//
// "This endpoint never writes" is the property that makes the feature safe
// to expose, and it should be true at the strongest available level rather
// than asserted in a comment. A GET says it in the HTTP verb: no route in
// this tree writes on GET, so a what-if that is a GET cannot become a write
// by someone later adding a line. A POST that happens not to write is a
// weaker claim, and the next person to touch it has no reason to keep it.

/** A field an admin may perturb, and the range the column actually allows. */
export interface OverridableField {
  min: number
  max: number
}

export type WhatIfSpec = Record<string, OverridableField>

export interface WhatIfResult<T> {
  /** The snapshot with any overrides applied. */
  snapshot: T
  /** Field names that were actually overridden, for the UI to flag. */
  overridden: string[]
  /** Human-readable rejections — an unknown field, or one out of range. */
  rejected: string[]
}

/**
 * The 0-100 band most simulation stats live in. Named rather than repeated
 * so a route can't quietly widen one field's range past what the column
 * accepts and produce reasoning for a state the world can never be in —
 * which would be a preview of nothing.
 */
export const STAT_BAND: OverridableField = { min: 0, max: 100 }

/**
 * Apply query-param overrides to a real entity snapshot.
 *
 * Out-of-range and unknown fields are REJECTED AND REPORTED rather than
 * clamped silently. Clamping would answer a question the admin didn't ask:
 * they typed 150 and would be shown the reasoning for 100 with nothing
 * saying so, which is worse than an error because it looks like an answer.
 */
export function applyWhatIf<T extends Record<string, unknown>>(
  snapshot: T,
  params: URLSearchParams,
  spec: WhatIfSpec
): WhatIfResult<T> {
  const overridden: string[] = []
  const rejected: string[] = []
  const patched: Record<string, unknown> = { ...snapshot }

  for (const [key, raw] of params.entries()) {
    // Only the fields a route explicitly opened. Anything else is either a
    // typo or an attempt to reach a field the preview doesn't model, and
    // both deserve to be told rather than ignored.
    const field = spec[key]
    if (!field) continue

    const value = Number(raw)
    if (!Number.isFinite(value)) {
      rejected.push(`${key}: "${raw}" is not a number`)
      continue
    }
    if (value < field.min || value > field.max) {
      rejected.push(`${key}: ${value} is outside ${field.min}–${field.max}`)
      continue
    }

    patched[key] = Math.trunc(value)
    overridden.push(key)
  }

  return { snapshot: patched as T, overridden: overridden.sort(), rejected }
}

/** True when the request asked for any what-if at all. */
export function isWhatIf(result: WhatIfResult<unknown>): boolean {
  return result.overridden.length > 0
}
