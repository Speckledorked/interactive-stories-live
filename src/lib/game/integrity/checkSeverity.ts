// src/lib/game/integrity/checkSeverity.ts
// #225: MAX_REPAIRS_PER_PASS/MAX_REPAIRS_PER_ENTITY (caps.ts) correctly
// stop repairing rather than half-applying a repair once a pass's blast-
// radius budget is spent — but which violations got a shot at that budget
// used to be pure array position: INTEGRITY_CHECKS registration order
// (checkRegistry.ts), not actual severity. If referential-integrity
// violations alone exceeded the cap in one pass, faction.leadership.
// exactlyOneLivingLeader repairs — arguably higher severity, a whole
// faction with no leader — never even got attempted that pass, purely
// because that check is registered after the referential-integrity family.
//
// Same closed-catalogue, per-checkKey registry shape as
// escalationSourceMap.ts/oracleTechnique.ts (Phase 5) — a severity ranking
// is exactly the kind of hand-reviewed, per-checkKey metadata this engine
// already has three other registries for.

import { CheckKey } from './checkKeys'

/**
 * Lower number = higher severity = gets first crack at the pass's repair
 * budget when MAX_REPAIRS_PER_PASS/MAX_REPAIRS_PER_ENTITY would otherwise
 * ration by coincidence of array position. Used ONLY to order which
 * repairable violations run first in a budget-constrained pass — never to
 * decide WHETHER something is repaired (that's still purely "does this
 * checkKey have a registered repair function", INTEGRITY_REPAIRS).
 */
export const CHECK_SEVERITY: Partial<Record<CheckKey, number>> = {
  // A faction with no living leader is functionally broken — succession,
  // goal reassessment, and war participation across several tick handlers
  // all assume a leader exists. Worth repairing before anything else
  // competes for the same pass's budget.
  'faction.leadership.exactlyOneLivingLeader': 0,
  // The inverse invariant on the same schema-documented "at most one
  // leader either way" rule — two simultaneous leadership claims is just
  // as functionally broken as zero (which one does succession/goal
  // reassessment/war participation actually defer to?), so it gets the
  // same top severity tier, not a lesser one.
  'faction.leadership.atMostOneLivingLeader': 0,

  // The actual shape of the Phase 0 crash bug (a live war pointing at a
  // location that no longer exists) — now backstopped by a real FK
  // (onDelete: SetNull), so this check is mostly a regression guard today,
  // but still structurally significant if it ever fires.
  'war.contestedLocationId.resolves': 1,

  // The rest of the referential-integrity family: an orphaned id-keyed
  // entry inside a JSON blob (relationships/reputation/debt counterparty/
  // clock participants). Real drift, worth fixing, but inert by the plan's
  // own framing — it does nothing until/unless some other code path reads
  // that specific dangling key — not a functional break the way a
  // leaderless faction is.
  //
  // #373: npc.socialTies.keys.resolve and faction.relationships.keys.resolve
  // left this list. They are detect-only regression guards now (the edge
  // tables' foreign keys make a dangling endpoint impossible at rest), and
  // an unranked, unrepairable checkKey never competes for the repair
  // budget — which is exactly what the rank was for.
  'clock.participantNpcIds.resolve': 2,
  'character.relationships.keys.resolve': 2,
  'character.resources.reputation.keys.resolve': 2,
  'debt.counterpartyId.resolves': 2,

  // Detect-only checkKeys (clock.sourceFactionId.active, the three
  // *.name.unique checks) have no entry in INTEGRITY_REPAIRS at all, so
  // they never compete for the repair budget regardless of severity —
  // deliberately left unranked here rather than given a number that would
  // never actually matter.
}

/** Anything not explicitly ranked above (including a future check nobody
 * has assigned a severity to yet) sorts after every ranked tier — a safer
 * default than assuming importance for something never reviewed. */
export const DEFAULT_SEVERITY = 99

export function severityOf(checkKey: string): number {
  return CHECK_SEVERITY[checkKey as CheckKey] ?? DEFAULT_SEVERITY
}
