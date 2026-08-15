// src/lib/game/integrity/oracleTechnique.ts
// Phase 5 (design, plan section 5d) — which mechanical oracle proves a
// generated fix correct for a given checkKey. 1d already establishes that
// the right technique is a property of the BUG CLASS a check represents,
// not of any one instance of it ("every check implies a fault-injection
// test", "the same technique covers every other id-keyed JSON blob") — so
// this is exactly as hand-maintained and closed as escalationSourceMap.ts.
//
// A checkKey with no entry defaults to 'suite-only' — the weakest oracle.
//
// Every tier now auto-merges (there is no human review step in this
// pipeline at all — see regressionDetection.ts for what replaces it: the
// system watches its own merges and reverts itself if one didn't actually
// work, rather than a person approving each one). Because nothing else
// checks a fix before it lands, this file also carries the one rule that
// keeps a fix from cheating its own gate: STRENGTH_RANK below makes it a
// mechanical, unconditional failure for any single diff to register a
// checkKey's technique as WEAKER than it was before that diff — an agent
// can raise its own bar (write a stronger test, upgrade an entry here) but
// can never lower it, checked in verifyOracleTechnique.ts, not trusted
// from the diff's own commit message.

import { CheckKey } from './checkKeys'

export type OracleTechnique = 'property' | 'fault-injection' | 'lint' | 'suite-only'

/** property/fault-injection/lint are all real, objective proof — which one
 * fits best is a judgment call about the bug shape, not a ranking worth
 * enforcing against each other. The one line that must never be crossed
 * unilaterally is real-oracle -> suite-only. */
const STRENGTH_RANK: Record<OracleTechnique, number> = {
  property: 2,
  'fault-injection': 2,
  lint: 2,
  'suite-only': 1,
}

/** True if `next` is a weaker oracle than `prior` — the one thing a single
 * diff is never allowed to do to its own checkKey's registered technique. */
export function isWeakerTechnique(prior: OracleTechnique, next: OracleTechnique): boolean {
  return STRENGTH_RANK[next] < STRENGTH_RANK[prior]
}

export const ORACLE_TECHNIQUE_FOR: Readonly<Partial<Record<CheckKey, OracleTechnique>>> = {
  // The Phase 0 relationship bug's own shape, and the class every other
  // id-keyed-JSON-blob check shares: "for any entity_id the AI could emit,
  // the roll-time reader must locate it" is a round-trip property, not a
  // worked example.
  'character.relationships.keys.resolve': 'property',
  'npc.socialTies.keys.resolve': 'property',
  'faction.relationships.keys.resolve': 'property',
  'character.resources.reputation.keys.resolve': 'property',

  // The Phase 0 war-crash bug's own shape: does the code survive a row
  // it depends on being deleted out from under it? Already has a real,
  // shipped example of exactly this oracle —
  // tick/__tests__/warTick.faultInjection.test.ts.
  'war.contestedLocationId.resolves': 'fault-injection',
  // Same "dangling id in a raw array/column, no FK possible" shape.
  'clock.participantNpcIds.resolve': 'fault-injection',

  // Deliberately absent (defaults to 'suite-only' — still auto-merges, per
  // the current design, but with the weakest available evidence):
  //
  // NOT 'character.relationships.keys.resolve' below, on purpose: it also
  // has a real, working AST-based structural guard (see
  // LINT_GUARD_FILE_FOR) — but 1d's own stated preference order is
  // property, then fault-injection, then lint, so the stronger technique
  // it already has wins as the PRIMARY declared one. The lint guard is
  // real, working, standing infrastructure regardless of which checkKey
  // ends up naming it as primary.
  //
  // - 'debt.counterpartyId.resolves' — the check's own doc comment says
  //   this is accepted best-effort behavior (counterpartyName stays
  //   authoritative regardless), not a defect to chase. Recurrence here is
  //   expected drift, not evidence of a bug.
  // - 'clock.sourceFactionId.active' and the three '*.name.unique' checks
  //   are detect-only by design (no repair function at all — see
  //   checkRegistry.ts) — there is no "was this actually fixed" question
  //   for an oracle to answer in the first place.
  // - 'faction.leadership.exactlyOneLivingLeader' — 1c names this
  //   checkKey's own escalation as ambiguous between "a wrong worldRule"
  //   and "a code path fighting it," which isn't a mechanical read. Phase
  //   4's per-family containment (once real oscillation-based retirement
  //   is built there — see Phase 5's 5h) is the right home for the first
  //   reading; code-level fix generation is a poor fit for either.
  // - 'faction.leadership.atMostOneLivingLeader' (#275) — same reasoning
  //   as its sibling immediately above: a recurring two-leader conflict is
  //   just as plausibly a worldRule letting co-leadership through on
  //   purpose as it is a write path skipping the cross-check this check
  //   exists to catch.
} as const

/**
 * Real, standing AST-based structural guards, keyed by the checkKey they
 * protect — the actual "lint rule" oracle 1d describes, just not literally
 * an ESLint plugin. This repo has no ESLint installed at all (no config,
 * no dependency), so these are implemented as vitest tests walking the
 * real TypeScript AST via the compiler API instead (see
 * entityResolutionConvention.test.ts's own doc comment for why). They are
 * STANDING tests, already re-run by the workflow's general `npx vitest
 * run` step — unlike 'property'/'fault-injection', which need a NEW test
 * generated per fix, a checkKey backed by one of these needs no new test
 * at all; the guard already exists and already runs.
 */
export const LINT_GUARD_FILE_FOR: Readonly<Partial<Record<CheckKey, string>>> = {
  'character.relationships.keys.resolve':
    'src/lib/game/worldUpdaters/__tests__/entityResolutionConvention.test.ts',
} as const

/** The technique for a checkKey, defaulting to the weakest ('suite-only')
 * when nothing stronger has been declared for it. */
export function oracleTechniqueFor(checkKey: string): OracleTechnique {
  return ORACLE_TECHNIQUE_FOR[checkKey as CheckKey] ?? 'suite-only'
}
