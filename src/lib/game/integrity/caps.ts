// src/lib/game/integrity/caps.ts
// Blast-radius limits for auto-repair (Phase 1's "auto-repair safety"). A
// pass that would exceed either cap stops applying further repairs for that
// campaign and reports the rest as unrepaired rather than mass-rewriting —
// the guard against a systematically wrong check silently rewriting an
// entire campaign in one pass.

/** Total repairs applied in a single integrity pass. */
export const MAX_REPAIRS_PER_PASS = 25

/** Repairs applied to any single entity in one pass — guards against one
 * check's repair fn oscillating against another's within the same pass. */
export const MAX_REPAIRS_PER_ENTITY = 3

// Escalation thresholds (see escalation.ts) — when a recurrence pattern
// stops looking like routine drift and starts looking like a code bug.

/** The same (checkKey, entity) repaired on this many SEPARATE turns means
 * something keeps re-corrupting that row — a correct repair should be
 * permanent, so recurrence itself is the signal, not the count. 2 is the
 * minimum that can even express "recurring" (a single occurrence is just a
 * normal repair). */
export const RECURRING_ENTITY_TURN_THRESHOLD = 2

/** The same checkKey firing on this many DISTINCT entities (even once each)
 * suggests a systematic bug in one write path, not several unrelated
 * one-offs. */
export const SYSTEMIC_ENTITY_COUNT_THRESHOLD = 3
