// src/lib/game/integrity/repairs/referentialIntegrity.ts
// Repair functions for checks/referentialIntegrity.ts. Kept in a separate
// file/module from the checks themselves (not because they're paired 1:1 —
// several checks below share the same repair shape) so a check can be read
// as "what's wrong" without also reading "what we do about it".

import { normalizeEntityName } from '../../entityResolution'
import { IntegritySnapshot, Repair, RepairFn } from '../types'

function idKeyedMap(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return { ...(value as Record<string, unknown>) }
}

/**
 * Drop every orphan key from an id-keyed JSON map, EXCEPT when the orphan
 * key is itself the exact (normalized) name of a real entity in `pool` — in
 * which case the entry is re-keyed to that entity's real id instead of
 * dropped. This is the "recovery, not cleanup" case from the plan: an AI
 * that wrote a relationship keyed by "Lord Kessler" instead of his real id
 * has real trust/tension/respect/fear history sitting under that key,
 * currently invisible to every reader that looks it up by id. Re-keying
 * resurrects it instead of deleting it.
 *
 * Deliberately exact-match only (not the fuzzy matcher entityResolution.ts
 * also offers) — this repair runs unattended, so it only recovers the
 * unambiguous case and drops everything else rather than guess.
 */
function repairIdKeyedMap(
  rawMap: unknown,
  pool: Array<{ id: string; name: string }>
): { map: Record<string, unknown>; changed: boolean } {
  const map = idKeyedMap(rawMap)
  const validIds = new Set(pool.map((p) => p.id))
  const byNormalizedName = new Map(pool.map((p) => [normalizeEntityName(p.name), p.id]))

  let changed = false
  for (const key of Object.keys(map)) {
    if (validIds.has(key)) continue
    const recoveredId = byNormalizedName.get(normalizeEntityName(key))
    if (recoveredId && !(recoveredId in map)) {
      map[recoveredId] = map[key]
    }
    delete map[key]
    changed = true
  }
  return { map, changed }
}

export const repairWarContestedLocation: RepairFn = (violation): Repair | null => ({
  violation,
  field: 'contestedLocationId',
  previousValue: 'a deleted Location',
  newValue: 'none',
  description: `Cleared ${violation.entityName}'s contested location, which no longer exists`,
  write: { model: 'war', id: violation.entityId, data: { contestedLocationId: null } },
})

export const repairClockParticipants: RepairFn = (violation, snapshot): Repair | null => {
  const clock = snapshot.clocks.find((c) => c.id === violation.entityId)
  if (!clock) return null
  const npcIds = new Set(snapshot.npcs.map((n) => n.id))
  const kept = clock.participantNpcIds.filter((id) => npcIds.has(id))
  if (kept.length === clock.participantNpcIds.length) return null

  return {
    violation,
    field: 'participantNpcIds',
    previousValue: clock.participantNpcIds.length,
    newValue: kept.length,
    description: `Removed ${clock.participantNpcIds.length - kept.length} deleted NPC(s) from ${clock.name}'s participants`,
    write: { model: 'clock', id: clock.id, data: { participantNpcIds: kept } },
  }
}

export const repairCharacterRelationships: RepairFn = (violation, snapshot): Repair | null => {
  const character = snapshot.characters.find((c) => c.id === violation.entityId)
  if (!character) return null
  const { map, changed } = repairIdKeyedMap(character.relationships, snapshot.npcs)
  if (!changed) return null

  return {
    violation,
    field: 'relationships',
    previousValue: Object.keys(idKeyedMap(character.relationships)).length,
    newValue: Object.keys(map).length,
    description: `Cleaned up ${character.name}'s relationships map — orphan NPC references dropped or recovered by name`,
    write: { model: 'character', id: character.id, data: { relationships: map } },
  }
}

// #373: repairNpcSocialTies and repairFactionRelationships used to live
// here. Both walked an id-keyed JSON blob and dropped (or name-recovered)
// keys pointing at deleted entities. Ties are FK'd edge rows now, so an
// orphan endpoint cannot exist at rest — Postgres cascades the edge away
// with the entity. The checks stay as regression guards (see
// checks/referentialIntegrity.ts); the repairs do not, and both keys are
// deliberately absent from the registry below.
//
// If the constraints were ever dropped and a dangling edge did appear, the
// repair would be a row DELETE, which this file's write shape ({ model,
// id, data }) does not express. Building delete plumbing for a case a
// foreign key already makes impossible would be inventing a mechanism to
// handle a state the schema forbids — the violation is reported to admin
// instead, which is the same posture the engine takes for every other
// detect-only check.

export const repairCharacterReputation: RepairFn = (violation, snapshot): Repair | null => {
  const character = snapshot.characters.find((c) => c.id === violation.entityId)
  if (!character) return null
  const resources = character.resources && typeof character.resources === 'object' && !Array.isArray(character.resources)
    ? { ...(character.resources as Record<string, unknown>) }
    : {}
  const { map, changed } = repairIdKeyedMap(resources.reputation, snapshot.factions)
  if (!changed) return null

  resources.reputation = map
  return {
    violation,
    field: 'resources.reputation',
    previousValue: Object.keys(idKeyedMap((character.resources as any)?.reputation)).length,
    newValue: Object.keys(map).length,
    description: `Cleaned up ${character.name}'s reputation tracking — orphan faction references dropped or recovered by name`,
    write: { model: 'character', id: character.id, data: { resources } },
  }
}

export const repairDebtCounterparty: RepairFn = (violation): Repair | null => ({
  violation,
  field: 'counterpartyId',
  previousValue: 'a deleted NPC or Faction',
  newValue: 'none',
  description: `Cleared the stale counterparty link on the debt with "${violation.entityName}" — the name stays on record`,
  write: { model: 'debt', id: violation.entityId, data: { counterpartyId: null } },
})

/** Registry: checkKey -> repair function. A check with no entry here is
 * detect-only by design (duplicateNames.ts, clock.sourceFactionId.active) —
 * runIntegrityPass treats a missing entry exactly like a repair fn
 * returning null, reporting the violation as unrepaired rather than
 * skipping it. */
export const REFERENTIAL_INTEGRITY_REPAIRS: Record<string, RepairFn> = {
  'war.contestedLocationId.resolves': repairWarContestedLocation,
  'clock.participantNpcIds.resolve': repairClockParticipants,
  'character.relationships.keys.resolve': repairCharacterRelationships,
  'character.resources.reputation.keys.resolve': repairCharacterReputation,
  'debt.counterpartyId.resolves': repairDebtCounterparty,
}
