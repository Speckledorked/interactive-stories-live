// src/lib/game/integrity/caps.ts
// Blast-radius limits for auto-repair (Phase 1's "auto-repair safety"). A
// pass that would exceed either cap stops applying further repairs for that
// campaign and reports the rest as unrepaired rather than mass-rewriting —
// the guard against a systematically wrong check silently rewriting an
// entire campaign in one pass, most relevant to the very first pass a
// mature campaign ever sees (see the plan's Phase 1c).

/** Total repairs applied in a single integrity pass. */
export const MAX_REPAIRS_PER_PASS = 25

/** Repairs applied to any single entity in one pass — guards against one
 * check's repair fn oscillating against another's within the same pass. */
export const MAX_REPAIRS_PER_ENTITY = 3
