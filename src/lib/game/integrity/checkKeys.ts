// src/lib/game/integrity/checkKeys.ts
// The closed set of every checkKey in the Integrity Engine — a single
// canonical list, where before there was none: checkRegistry.ts (each
// check's own `key` field), escalationSourceMap.ts's
// ESCALATION_SOURCE_FILES, and oracleTechnique.ts's ORACLE_TECHNIQUE_FOR/
// LINT_GUARD_FILE_FOR all keyed off the same 11 strings as independently-
// typed bare `string`s, with nothing tying them together. A rename in one
// registry used to desync the others silently — caught only by an
// existence-consistency test at runtime (REGISTERED_KEYS.has(key)), never
// by the compiler.
//
// Every check's own `key` field is now written `'...' satisfies CheckKey`
// at its definition site, and the other three registries are typed
// Partial<Record<CheckKey, ...>> instead of Record<string, ...> — so
// renaming a key here without updating every consumer now fails to
// compile (an object literal with an unknown property, or a literal not
// assignable to the union) instead of silently passing until the next
// test run.
export type CheckKey =
  | 'character.relationships.keys.resolve'
  | 'npc.socialTies.keys.resolve'
  | 'faction.relationships.keys.resolve'
  | 'character.resources.reputation.keys.resolve'
  | 'war.contestedLocationId.resolves'
  | 'clock.participantNpcIds.resolve'
  | 'debt.counterpartyId.resolves'
  | 'clock.sourceFactionId.active'
  | 'faction.leadership.exactlyOneLivingLeader'
  | 'npc.name.unique'
  | 'faction.name.unique'
  | 'quest.name.unique'
