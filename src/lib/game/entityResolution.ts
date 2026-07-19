// src/lib/game/entityResolution.ts
// Exact-match -> confidence-gated fuzzy match entity resolution for the AI
// write-back (stateUpdater.ts). Replaces `contains`-mode name matching,
// which had two failure modes at once: it could cross-match an entirely
// unrelated entity whose name merely contained the search string (e.g. a
// report about "Bob" landing on "Bobby's Assistant"), and it could fail to
// match on a trivial AI-side typo/case/whitespace variance, silently
// auto-creating a duplicate stub NPC instead of updating the real one.
// Known Bugs P0 — see README.
//
// Resolution order: exact id -> exact name (case/whitespace-insensitive) ->
// a single, sufficiently-confident fuzzy match. Multiple ambiguous fuzzy
// candidates resolve to "ambiguous", not a guess — callers must treat that
// the same as "not found" rather than picking one, since guessing wrong
// here is exactly the corruption this module exists to prevent.

export interface ResolvableEntity {
  id: string
  name: string
}

export function normalizeEntityName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Standard iterative Levenshtein edit distance (two-row DP — no need for a
 * dependency at the name lengths this deals with).
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m

  let prev = new Array(n + 1)
  let curr = new Array(n + 1)
  for (let j = 0; j <= n; j++) prev[j] = j

  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(
        prev[j] + 1, // deletion
        curr[j - 1] + 1, // insertion
        prev[j - 1] + cost // substitution
      )
    }
    const tmp = prev
    prev = curr
    curr = tmp
  }
  return prev[n]
}

// A tight gate, not a general "close enough" matcher: small absolute edit
// distance AND small relative to length, so "Bob" vs "Rob" (distance 1 of
// 3, a 33% edit) doesn't slip through as confidently as "Kesler" vs
// "Kessler" (distance 1 of 7, a 14% edit) — this is built to catch AI-side
// typos, pluralization, and punctuation drift, never a genuinely different
// short name.
const MAX_EDIT_DISTANCE = 2
const MAX_EDIT_RATIO = 0.2

export function isConfidentFuzzyMatch(candidateName: string, targetName: string): boolean {
  const a = normalizeEntityName(candidateName)
  const b = normalizeEntityName(targetName)
  if (!a || !b) return false
  if (a === b) return true
  const distance = levenshteinDistance(a, b)
  const maxLen = Math.max(a.length, b.length)
  return distance <= MAX_EDIT_DISTANCE && distance / maxLen <= MAX_EDIT_RATIO
}

export type ResolutionOutcome<T> =
  | { kind: 'found'; entity: T }
  | { kind: 'ambiguous'; candidates: T[] }
  | { kind: 'not_found' }

/**
 * Resolve an AI-reported `nameOrId` against a roster already scoped to the
 * campaign — exact id, then exact name, then a single confident fuzzy
 * match. Never a substring/`contains` match. Pure and synchronous so
 * callers fetch the roster once per batch (see stateUpdater.ts) instead of
 * running a fresh query per change.
 */
export function resolveEntityByNameOrId<T extends ResolvableEntity>(
  candidates: T[],
  nameOrId: string
): ResolutionOutcome<T> {
  const byId = candidates.find(c => c.id === nameOrId)
  if (byId) return { kind: 'found', entity: byId }

  const normalizedInput = normalizeEntityName(nameOrId)
  if (!normalizedInput) return { kind: 'not_found' }

  const byExactName = candidates.find(c => normalizeEntityName(c.name) === normalizedInput)
  if (byExactName) return { kind: 'found', entity: byExactName }

  const fuzzyMatches = candidates.filter(c => isConfidentFuzzyMatch(nameOrId, c.name))
  if (fuzzyMatches.length === 1) return { kind: 'found', entity: fuzzyMatches[0] }
  if (fuzzyMatches.length > 1) return { kind: 'ambiguous', candidates: fuzzyMatches }
  return { kind: 'not_found' }
}
