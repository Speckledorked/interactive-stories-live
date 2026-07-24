// src/lib/game/textAppend.ts
//
// Bounded append for the free-text fields the AI extends every turn.
//
// Several durable text fields were written with plain string concatenation
// and no ceiling — `NPC.gmNotes`, `Faction.gmNotes`, `Location.gmNotes`,
// `Quest.progressLog`, and a character's `appearance`/`personality`. Each
// grows by a paragraph or two per relevant scene and is read straight back
// into the AI prompt, so an old campaign pays for its whole history on
// every single call, forever, in both DB row size and tokens. That's the
// same problem `memoryConsolidation.ts` already solves for campaign memory
// and `worldMetaNotes.ts` solves for GM-note history; this is the shared
// version for the plain-text fields neither of those covers.
//
// Deliberately "keep the newest, drop the oldest" rather than an
// AI-summarized rollup like memoryConsolidation's era summaries: these
// fields are consulted for *current* state ("what does this NPC look like
// now", "where is this quest up to"), and rolling them up would mean an
// extra AI call per entity per trim — real cost for content whose oldest
// entries are the least relevant part. Trimming is also honest about
// itself: a marker line replaces what was dropped, so neither a human
// reading the admin panel nor the model reading the prompt is misled into
// thinking it's seeing the entity's complete history.

/** Marks where older entries were dropped. Kept short — it costs tokens too. */
export const TRIM_MARKER = '…(earlier entries trimmed)'

export interface AppendBoundedOptions {
  /** How entries are joined. Must match how the field is already written. */
  separator: string
  /** Max entries to retain, newest-first. */
  maxEntries: number
  /** Hard character ceiling, applied after the entry cap. */
  maxChars: number
}

/**
 * Append `addition` to `existing`, then trim the oldest entries until the
 * result fits both ceilings.
 *
 * Returns the field's new value. Pure — no DB access, no clock, no I/O.
 *
 * Trimming always preserves the newest entries and never splits one in the
 * middle: if a single entry alone exceeds `maxChars` it is truncated at a
 * word boundary rather than mid-word, since these strings are prose that
 * gets shown to people.
 */
export function appendBounded(
  existing: string | null | undefined,
  addition: string,
  opts: AppendBoundedOptions
): string {
  const { separator, maxEntries, maxChars } = opts

  const priorEntries = (existing ?? '')
    .split(separator)
    .map(entry => entry.trim())
    // Drop a marker from a previous trim — a fresh one is re-added below if
    // this pass also trims, so markers can never stack up over time.
    .filter(entry => entry.length > 0 && entry !== TRIM_MARKER)

  const trimmedAddition = addition.trim()
  const entries = trimmedAddition.length > 0 ? [...priorEntries, trimmedAddition] : priorEntries
  if (entries.length === 0) return ''

  let kept = entries.slice(-maxEntries)
  let didTrim = kept.length < entries.length

  // Character ceiling, newest-first: drop whole entries from the front while
  // the joined result (including the marker we'd need to add) is too long.
  const joinedLength = (list: string[], withMarker: boolean) =>
    [...(withMarker ? [TRIM_MARKER] : []), ...list].join(separator).length

  while (kept.length > 1 && joinedLength(kept, didTrim || kept.length < entries.length) > maxChars) {
    kept = kept.slice(1)
    didTrim = true
  }

  // A single entry can still blow the ceiling on its own — truncate it at a
  // word boundary rather than dropping the only content there is. The budget
  // has to leave room for the marker and separator this is about to prepend,
  // or the "fix" overshoots maxChars by exactly that much.
  if (kept.length === 1) {
    const soloBudget = Math.max(0, maxChars - TRIM_MARKER.length - separator.length)
    if (kept[0].length > soloBudget) {
      kept = [truncateAtWord(kept[0], soloBudget)]
      didTrim = true
    }
  }

  return (didTrim ? [TRIM_MARKER, ...kept] : kept).join(separator)
}

/**
 * Cut `text` to at most `maxChars`, backing up to the last whitespace so a
 * word isn't sliced in half. Falls back to a hard cut when there's no
 * whitespace to back up to (a single very long token).
 */
export function truncateAtWord(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const hardCut = text.slice(0, maxChars)
  const lastSpace = hardCut.lastIndexOf(' ')
  // Only honor the word boundary if it doesn't throw away most of the text.
  return lastSpace > maxChars * 0.5 ? hardCut.slice(0, lastSpace) : hardCut
}

// ---------------------------------------------------------------------------
// Per-field limits
// ---------------------------------------------------------------------------
// Sized against what each field is actually for, not one blanket number.
// All are far above what normal play produces in an arc — the point is a
// ceiling that exists at all, not a tight editorial budget.

/** GM/host notes on an NPC, faction, or location. Paragraph-separated. */
export const GM_NOTES_BOUNDS: AppendBoundedOptions = {
  separator: '\n\n',
  maxEntries: 12,
  maxChars: 4000,
}

/** A quest's progress beats. One line per beat, already "Turn N:"-prefixed. */
export const QUEST_PROGRESS_BOUNDS: AppendBoundedOptions = {
  separator: '\n',
  maxEntries: 20,
  maxChars: 3000,
}

/**
 * A character's accumulated appearance/personality drift.
 *
 * Tighter than GM notes: this describes how someone looks and acts *now*,
 * and it's re-read into the prompt on every scene that character appears
 * in. Unlike the fields above it's continuous prose joined by spaces
 * rather than discrete separator-delimited entries, so it gets
 * appendBoundedProse instead — splitting it on its separator would split
 * it on words.
 */
export const MAX_CHARACTER_DESCRIPTION_CHARS = 1500

/**
 * Append to a continuous prose field, keeping the most recent text within
 * `maxChars`.
 *
 * Kept separate from appendBounded because there are no entry boundaries
 * to preserve here — the value is one flowing description, and the newest
 * additions are the ones that describe the character's current state, so
 * overflow is trimmed off the front at a word boundary.
 */
export function appendBoundedProse(
  existing: string | null | undefined,
  addition: string,
  maxChars: number
): string {
  const prior = (existing ?? '').replace(TRIM_MARKER, '').trim()
  const trimmedAddition = addition.trim()
  const combined = prior ? `${prior} ${trimmedAddition}`.trim() : trimmedAddition

  if (combined.length <= maxChars) return combined

  // Keep the tail (newest prose), leaving room for the marker.
  const budget = Math.max(0, maxChars - TRIM_MARKER.length - 1)
  const tail = combined.slice(combined.length - budget)
  const firstSpace = tail.indexOf(' ')
  const wordAligned = firstSpace > -1 && firstSpace < budget * 0.5 ? tail.slice(firstSpace + 1) : tail
  return `${TRIM_MARKER} ${wordAligned}`.trim()
}

/**
 * Cap on retained advancement-log entries.
 *
 * Set well above one arc's worth on purpose: `countGrantsInArc`
 * (advancement.ts) reads this same list to enforce the per-arc perk/ability
 * grant budget, so trimming must never be able to hide a recent grant and
 * hand a character free budget. Trimming keeps the NEWEST entries, which is
 * exactly the window that function looks at, and 50 entries is many arcs'
 * worth of grants — the running totals (totalPerksGained etc.) stay exact
 * regardless, since they're counters rather than derived from this array.
 */
export const MAX_ADVANCEMENT_LOG_ENTRIES = 50

/** Trim an advancement log's entries array in place-safe fashion (pure). */
export function boundAdvancementEntries<T>(entries: T[]): T[] {
  return entries.length > MAX_ADVANCEMENT_LOG_ENTRIES
    ? entries.slice(-MAX_ADVANCEMENT_LOG_ENTRIES)
    : entries
}
