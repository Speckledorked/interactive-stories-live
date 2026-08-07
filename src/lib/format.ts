// src/lib/format.ts
// Small text-formatting helpers that were hand-repeated at each call site
// rather than shared, found during the shared-utilities audit (see
// README's shared-utilities refactor entry).

/**
 * "1 item" vs "2 items" — appends `s` unless count is exactly 1. Every
 * existing call site already did precisely this ternary inline; this only
 * removes the repetition, not the rule itself (no irregular plurals, no
 * locale handling — none of the callers needed either).
 */
export function pluralize(count: number, word: string): string {
  return `${word}${count !== 1 ? 's' : ''}`
}

/**
 * Cuts `text` to `cutChars` and appends '...' once `text` exceeds
 * `maxChars`; returns `text` unchanged otherwise. `cutChars` defaults to
 * `maxChars` (matching most call sites), but is a separate parameter
 * because one existing call site caps the *total* output length at
 * `maxChars` by cutting 3 chars short to leave room for the ellipsis —
 * preserved here rather than smoothed over.
 */
export function truncateWithEllipsis(text: string, maxChars: number, cutChars: number = maxChars): string {
  return text.length > maxChars ? text.substring(0, cutChars) + '...' : text
}

/**
 * The mirror of truncateWithEllipsis: keeps the END of `text` and drops the
 * beginning, prefixing '...' once `text` exceeds `maxChars`. For content
 * where what happened most recently matters more than what came first — the
 * tail is the freshest information, not filler.
 */
export function truncateFromStart(text: string, maxChars: number): string {
  return text.length > maxChars ? '...' + text.slice(text.length - maxChars) : text
}
