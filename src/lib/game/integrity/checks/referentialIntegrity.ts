// src/lib/game/integrity/checks/referentialIntegrity.ts
// "Does every reference in this campaign point at something real" — the
// structural tier's core question, true in every fiction regardless of
// setting. Split into one IntegrityCheck per source field rather than one
// giant function, so a single violation is attributable to exactly the
// column that produced it (matches Violation.checkKey feeding Phase 1d's
// per-check oscillation tracking).

import { IntegrityCheck, IntegritySnapshot, Violation } from '../types'

function idKeyedMapKeys(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  return Object.keys(value as Record<string, unknown>)
}

/** War.contestedLocationId resolves. Regression guard, not a live risk: the
 * column now has a real FK with onDelete: SetNull (see the Phase 0 migration
 * 20260729000000_war_contested_location_fk), so Postgres itself makes this
 * violation impossible at rest. Kept as a check so dropping that constraint
 * in some future migration is caught here rather than by a crash mid-tick. */
export const warContestedLocationResolves: IntegrityCheck = {
  key: 'war.contestedLocationId.resolves',
  description: 'War.contestedLocationId must reference an existing Location',
  run(snapshot: IntegritySnapshot): Violation[] {
    const violations: Violation[] = []
    for (const war of snapshot.wars) {
      if (war.contestedLocationId && !snapshot.locationIds.has(war.contestedLocationId)) {
        violations.push({
          checkKey: 'war.contestedLocationId.resolves',
          entityType: 'WAR',
          entityId: war.id,
          entityName: war.name,
          description: `War "${war.name}" is contesting a Location (${war.contestedLocationId}) that no longer exists`,
        })
      }
    }
    return violations
  },
}

/** Clock.participantNpcIds is a raw String[] with no FK (schema:1157) — an
 * NPC row can be deleted (or, more commonly, never actually created if a
 * stub failed) while a joint-scheme Clock still lists it. */
export const clockParticipantNpcsResolve: IntegrityCheck = {
  key: 'clock.participantNpcIds.resolve',
  description: 'Every id in Clock.participantNpcIds must reference an existing NPC',
  run(snapshot: IntegritySnapshot): Violation[] {
    const npcIds = new Set(snapshot.npcs.map((n) => n.id))
    const violations: Violation[] = []
    for (const clock of snapshot.clocks) {
      const missing = clock.participantNpcIds.filter((id) => !npcIds.has(id))
      if (missing.length > 0) {
        violations.push({
          checkKey: 'clock.participantNpcIds.resolve',
          entityType: 'CLOCK',
          entityId: clock.id,
          entityName: clock.name,
          description: `Clock "${clock.name}" lists ${missing.length} participant NPC id(s) that no longer exist`,
        })
      }
    }
    return violations
  },
}

/** Character.relationships is a JSON map keyed by NPC id (schema:735), with
 * no FK possible on a JSON column — this is the shape the Phase 0 orphan-key
 * bug wrote into, and this check is what catches every instance of it that
 * already exists in a campaign's data (the fix in worldUpdaters/characters.ts
 * only prevents NEW ones). */
export const characterRelationshipKeysResolve: IntegrityCheck = {
  key: 'character.relationships.keys.resolve',
  description: 'Every key in Character.relationships must reference an existing NPC',
  run(snapshot: IntegritySnapshot): Violation[] {
    const npcIds = new Set(snapshot.npcs.map((n) => n.id))
    const violations: Violation[] = []
    for (const character of snapshot.characters) {
      const orphanKeys = idKeyedMapKeys(character.relationships).filter((id) => !npcIds.has(id))
      if (orphanKeys.length > 0) {
        violations.push({
          checkKey: 'character.relationships.keys.resolve',
          entityType: 'CHARACTER',
          entityId: character.id,
          entityName: character.name,
          description: `${character.name}'s relationships reference ${orphanKeys.length} NPC id(s) that don't exist: ${orphanKeys.join(', ')}`,
        })
      }
    }
    return violations
  },
}

/** NPC.socialTies (schema:861) — same JSON-map-keyed-by-NPC-id shape as
 * Character.relationships, written by tick/npcSocietyTick.ts. */
export const npcSocialTiesKeysResolve: IntegrityCheck = {
  key: 'npc.socialTies.keys.resolve',
  description: 'Every key in NPC.socialTies must reference an existing NPC',
  run(snapshot: IntegritySnapshot): Violation[] {
    const npcIds = new Set(snapshot.npcs.map((n) => n.id))
    const violations: Violation[] = []
    for (const npc of snapshot.npcs) {
      const orphanKeys = idKeyedMapKeys(npc.socialTies).filter((id) => id !== npc.id && !npcIds.has(id))
      if (orphanKeys.length > 0) {
        violations.push({
          checkKey: 'npc.socialTies.keys.resolve',
          entityType: 'NPC',
          entityId: npc.id,
          entityName: npc.name,
          description: `${npc.name}'s social ties reference ${orphanKeys.length} NPC id(s) that don't exist: ${orphanKeys.join(', ')}`,
        })
      }
    }
    return violations
  },
}

/** Faction.relationships (schema:898) — JSON map keyed by the OTHER
 * faction's id. A deleted/collapsed-and-removed faction leaves stale keys
 * in every faction that used to track it. */
export const factionRelationshipKeysResolve: IntegrityCheck = {
  key: 'faction.relationships.keys.resolve',
  description: 'Every key in Faction.relationships must reference an existing Faction',
  run(snapshot: IntegritySnapshot): Violation[] {
    const factionIds = new Set(snapshot.factions.map((f) => f.id))
    const violations: Violation[] = []
    for (const faction of snapshot.factions) {
      const orphanKeys = idKeyedMapKeys(faction.relationships).filter((id) => id !== faction.id && !factionIds.has(id))
      if (orphanKeys.length > 0) {
        violations.push({
          checkKey: 'faction.relationships.keys.resolve',
          entityType: 'FACTION',
          entityId: faction.id,
          entityName: faction.name,
          description: `${faction.name}'s relationships reference ${orphanKeys.length} faction id(s) that don't exist: ${orphanKeys.join(', ')}`,
        })
      }
    }
    return violations
  },
}

/** Character.resources.reputation (schema:718) is a JSON map keyed by
 * faction id — the third id-keyed-JSON-blob shape, same failure class as
 * the relationships checks above. */
export const characterReputationKeysResolve: IntegrityCheck = {
  key: 'character.resources.reputation.keys.resolve',
  description: "Every key in Character.resources.reputation must reference an existing Faction",
  run(snapshot: IntegritySnapshot): Violation[] {
    const factionIds = new Set(snapshot.factions.map((f) => f.id))
    const violations: Violation[] = []
    for (const character of snapshot.characters) {
      const resources = character.resources
      const reputation = resources && typeof resources === 'object' && !Array.isArray(resources)
        ? (resources as Record<string, unknown>).reputation
        : undefined
      const orphanKeys = idKeyedMapKeys(reputation).filter((id) => !factionIds.has(id))
      if (orphanKeys.length > 0) {
        violations.push({
          checkKey: 'character.resources.reputation.keys.resolve',
          entityType: 'CHARACTER',
          entityId: character.id,
          entityName: character.name,
          description: `${character.name}'s reputation tracks ${orphanKeys.length} faction id(s) that don't exist: ${orphanKeys.join(', ')}`,
        })
      }
    }
    return violations
  },
}

/** Debt.counterpartyId (schema:587-591) is a nullable id with no relation,
 * best-effort resolved at write time (debts.ts:104-120) — it can be set and
 * stale if the NPC/faction it pointed at is later deleted. counterpartyName
 * stays authoritative regardless, so this never blocks the debt from
 * displaying; it only flags that the id link has gone stale. */
export const debtCounterpartyResolves: IntegrityCheck = {
  key: 'debt.counterpartyId.resolves',
  description: 'Debt.counterpartyId, when set, must reference an existing NPC or Faction',
  run(snapshot: IntegritySnapshot): Violation[] {
    const npcIds = new Set(snapshot.npcs.map((n) => n.id))
    const factionIds = new Set(snapshot.factions.map((f) => f.id))
    const violations: Violation[] = []
    for (const debt of snapshot.debts) {
      if (!debt.counterpartyId) continue
      const pool = debt.counterpartyType === 'faction' ? factionIds : npcIds
      if (!pool.has(debt.counterpartyId)) {
        violations.push({
          checkKey: 'debt.counterpartyId.resolves',
          entityType: 'DEBT',
          entityId: debt.id,
          entityName: debt.counterpartyName,
          description: `Debt with "${debt.counterpartyName}" points at a ${debt.counterpartyType} id that no longer exists`,
        })
      }
    }
    return violations
  },
}

/** An active Clock's sourceFactionId pointing at a collapsed/inactive
 * faction is a real, reachable state: factionTick.ts's collapse path
 * deactivates the faction but doesn't touch clocks it originated. */
export const clockSourceFactionActive: IntegrityCheck = {
  key: 'clock.sourceFactionId.active',
  description: 'An unresolved Clock with a sourceFactionId should reference an active Faction',
  run(snapshot: IntegritySnapshot): Violation[] {
    const activeFactionIds = new Set(snapshot.factions.filter((f) => f.isActive).map((f) => f.id))
    const allFactionIds = new Set(snapshot.factions.map((f) => f.id))
    const violations: Violation[] = []
    for (const clock of snapshot.clocks) {
      if (clock.resolvedAt) continue
      if (!clock.sourceFactionId) continue
      // A missing faction entirely is the referentialIntegrity concern of a
      // different check family were one added for Faction ids on Clock; here
      // we only flag "exists but collapsed", which is the case clockTick.ts's
      // own pacing logic already reads (`if (!faction?.isActive) return 0`)
      // but never corrects.
      if (allFactionIds.has(clock.sourceFactionId) && !activeFactionIds.has(clock.sourceFactionId)) {
        violations.push({
          checkKey: 'clock.sourceFactionId.active',
          entityType: 'CLOCK',
          entityId: clock.id,
          entityName: clock.name,
          description: `Clock "${clock.name}" is still driven by a faction that has collapsed`,
        })
      }
    }
    return violations
  },
}

export const REFERENTIAL_INTEGRITY_CHECKS: IntegrityCheck[] = [
  warContestedLocationResolves,
  clockParticipantNpcsResolve,
  characterRelationshipKeysResolve,
  npcSocialTiesKeysResolve,
  factionRelationshipKeysResolve,
  characterReputationKeysResolve,
  debtCounterpartyResolves,
  clockSourceFactionActive,
]
