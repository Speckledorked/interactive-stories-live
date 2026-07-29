// src/lib/game/integrity/oracleTechnique.ts
// Phase 5 (design, plan section 5d) — which mechanical oracle proves a
// generated fix correct for a given checkKey. 1d already establishes that
// the right technique is a property of the BUG CLASS a check represents,
// not of any one instance of it ("every check implies a fault-injection
// test", "the same technique covers every other id-keyed JSON blob") — so
// this is exactly as hand-maintained and closed as escalationSourceMap.ts.
//
// A checkKey with no entry defaults to 'suite-only' — the weakest oracle,
// and per the Phase 5 automation table, NEVER auto-merge-eligible. That is
// the safe default, not a gap to fill in a hurry.

export type OracleTechnique = 'property' | 'fault-injection' | 'lint' | 'suite-only'

export const ORACLE_TECHNIQUE_FOR: Readonly<Record<string, OracleTechnique>> = {
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

  // Deliberately absent (defaults to 'suite-only', never auto-merge-eligible):
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
} as const

/** Whether a checkKey's fix (once generated) can ever qualify for
 * auto-merge — i.e. whether it has a real oracle, not just "suite stays
 * green." */
export function isAutoMergeEligibleTechnique(technique: OracleTechnique): boolean {
  return technique !== 'suite-only'
}

/** The technique for a checkKey, defaulting to the weakest ('suite-only')
 * when nothing stronger has been declared for it. */
export function oracleTechniqueFor(checkKey: string): OracleTechnique {
  return ORACLE_TECHNIQUE_FOR[checkKey] ?? 'suite-only'
}
