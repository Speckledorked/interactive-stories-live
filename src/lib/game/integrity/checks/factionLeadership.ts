// src/lib/game/integrity/checks/factionLeadership.ts
// "A faction with living affiliated members has exactly one living LEADER"
// — the invariant tick/leadershipTick.ts already enforces every tick. This
// check is a safety net, not new logic: it reuses the exact same pure
// decideSuccession the tick handler does, so there is only one definition
// of "who should lead" in the codebase, not two that could drift apart.
//
// Why this needs its own integrity check even though leadershipTick already
// runs every turn: the Integrity Engine's pass sees the WHOLE campaign (no
// factionCap), while leadershipTick is capped per turn — a campaign with
// more factions than the cap can have one sit leaderless past its tick
// entirely. This check (and its repair) is what actually fixes that,
// running last in TICK_HANDLERS with no cap of its own.
//
// Phase 4: "exactly one living LEADER" is universe-dependent, not a law of
// physics — an anarchist collective or a hive-mind faction can be
// leaderless on purpose. When this campaign's worldRules say so (via the
// 'faction.leaderOptional' family, and only once that verdict is confident
// and past its probation window — see worldRules.ts), this check simply
// doesn't fire for that faction. Absent or inactive rules mean this runs
// exactly as it always has.

import { decideSuccession, detectLeadershipConflict } from '../../tick/leadershipTick'
import { IntegrityCheck, IntegritySnapshot, Repair, RepairFn, Violation } from '../types'
import { isRuleActive, ruleFor } from '../worldRules'
import { CheckKey } from '../checkKeys'

function membersFor(snapshot: IntegritySnapshot, factionId: string) {
  return snapshot.npcs
    .filter((npc) => npc.isAlive && npc.factionId === factionId)
    .map((npc) => ({ id: npc.id, name: npc.name, importance: npc.importance, factionRole: npc.factionRole }))
}

export const factionHasOneLivingLeader: IntegrityCheck = {
  key: 'faction.leadership.exactlyOneLivingLeader' satisfies CheckKey,
  description: 'An active Faction with living affiliated members should have exactly one living LEADER',
  run(snapshot: IntegritySnapshot): Violation[] {
    const leaderOptional = isRuleActive(ruleFor(snapshot.worldRules, 'faction.leaderOptional'), snapshot.turnNumber)
    if (leaderOptional) return []

    const violations: Violation[] = []
    for (const faction of snapshot.factions) {
      if (!faction.isActive) continue
      const decision = decideSuccession({
        name: faction.name,
        leaderCharacterId: faction.leaderCharacterId,
        members: membersFor(snapshot, faction.id),
      })
      if (decision) {
        violations.push({
          checkKey: 'faction.leadership.exactlyOneLivingLeader',
          entityType: 'FACTION',
          entityId: faction.id,
          entityName: faction.name,
          description: `${faction.name} has living members but no living LEADER`,
        })
      }
    }
    return violations
  },
}

export const repairFactionLeadership: RepairFn = (violation, snapshot): Repair | null => {
  const faction = snapshot.factions.find((f) => f.id === violation.entityId)
  if (!faction) return null
  const decision = decideSuccession({
    name: faction.name,
    leaderCharacterId: faction.leaderCharacterId,
    members: membersFor(snapshot, faction.id),
  })
  if (!decision) return null

  return {
    violation,
    // Reported as the NPC's role changing, matching leadershipTick.ts's own
    // WorldChange for the identical decision — not "the faction changed",
    // even though the violation was detected on the faction.
    entityType: 'NPC',
    entityId: decision.successorId,
    entityName: decision.successorName,
    field: 'factionRole',
    previousValue: decision.previousRole,
    newValue: 'LEADER',
    description: decision.reason,
    write: { model: 'nPC', id: decision.successorId, data: { factionRole: 'LEADER' } },
  }
}

// #275: the inverse invariant — "at most one leader", not "at least one".
// `factionHasOneLivingLeader` above reuses `decideSuccession`, which can
// only ever detect a MISSING leader (its first two lines return null the
// instant EITHER a PC leader or any NPC LEADER already exists — either
// looks like "already has a leader, nothing to do" to that function). A
// faction that's landed with TWO simultaneous leadership claims (an NPC
// create/update route setting factionRole: LEADER with no cross-check
// against Faction.leaderCharacterId or another living LEADER NPC on the
// same faction — the gap this check exists to catch) was invisible to
// both the tick and this engine before now. One violation per conflicting
// NPC (not one per faction) so each has a single, self-contained repair —
// matching Repair's own one-entity-one-write shape.
export const factionHasAtMostOneLivingLeader: IntegrityCheck = {
  key: 'faction.leadership.atMostOneLivingLeader' satisfies CheckKey,
  description: 'An active Faction should never have more than one simultaneous leadership claim (a PC leader alongside an NPC LEADER, or more than one living NPC LEADER)',
  run(snapshot: IntegritySnapshot): Violation[] {
    const violations: Violation[] = []
    for (const faction of snapshot.factions) {
      if (!faction.isActive) continue
      const conflict = detectLeadershipConflict({
        name: faction.name,
        leaderCharacterId: faction.leaderCharacterId,
        members: membersFor(snapshot, faction.id),
      })
      if (!conflict) continue
      for (const npcId of conflict.conflictingLeaderIds) {
        const npc = snapshot.npcs.find((n) => n.id === npcId)
        if (!npc) continue
        violations.push({
          checkKey: 'faction.leadership.atMostOneLivingLeader',
          entityType: 'NPC',
          entityId: npc.id,
          entityName: npc.name,
          description: conflict.reason,
        })
      }
    }
    return violations
  },
}

export const repairFactionLeadershipConflict: RepairFn = (violation): Repair | null => {
  return {
    violation,
    entityType: 'NPC',
    entityId: violation.entityId,
    entityName: violation.entityName,
    field: 'factionRole',
    previousValue: 'LEADER',
    newValue: 'MEMBER',
    description: `${violation.entityName} demoted to MEMBER to resolve a duplicate-leader conflict: ${violation.description}`,
    write: { model: 'nPC', id: violation.entityId, data: { factionRole: 'MEMBER' } },
  }
}

// #476: the precondition both checks above silently depend on.
//
// Faction.leaderCharacterId is the "a player leads this" marker.
// decideSuccession returns null the instant it is set, and
// detectLeadershipConflict counts it as a living leader — so a faction
// whose PC leader has DIED reads, to every path in the system, as a
// faction that already has a leader. Succession is not merely delayed; it
// is suppressed permanently and invisibly, by the very field the leadership
// invariant is keyed on. Deleting the character was always safe
// (onDelete: SetNull). Death was the hole.
//
// The death path now clears this itself (worldUpdaters/characters.ts), so
// this check is the safety net and the repair for rows already in that
// state — the same relationship factionHasOneLivingLeader has to
// leadershipTick. It also covers the FK pointing at a character that is
// gone from the snapshot entirely, which the SetNull constraint should
// prevent but which costs nothing to notice.
//
// Registered before the two checks above, and given the same top severity,
// because clearing the stale FK is what lets either of them see anything
// at all.
export const factionLeaderCharacterIsAlive: IntegrityCheck = {
  key: 'faction.leaderCharacterId.alive' satisfies CheckKey,
  description: 'A Faction.leaderCharacterId should point at a living character',
  run(snapshot: IntegritySnapshot): Violation[] {
    const violations: Violation[] = []
    for (const faction of snapshot.factions) {
      if (!faction.isActive) continue
      if (!faction.leaderCharacterId) continue

      const leader = snapshot.characters.find((c) => c.id === faction.leaderCharacterId)
      if (leader && leader.isAlive) continue

      violations.push({
        checkKey: 'faction.leaderCharacterId.alive',
        entityType: 'FACTION',
        entityId: faction.id,
        entityName: faction.name,
        description: leader
          ? `${faction.name} is still led by ${leader.name}, who is dead — succession cannot begin until the leader of record is released`
          : `${faction.name} names a leader character that no longer exists`,
      })
    }
    return violations
  },
}

export const repairFactionLeaderCharacterAlive: RepairFn = (violation, snapshot): Repair | null => {
  const faction = snapshot.factions.find((f) => f.id === violation.entityId)
  if (!faction || !faction.leaderCharacterId) return null

  const leader = snapshot.characters.find((c) => c.id === faction.leaderCharacterId)

  return {
    violation,
    // Reported on the faction, unlike the succession repair next door: the
    // thing that changes here IS the faction's own column, and no NPC has
    // been promoted yet. That happens on the following pass, once this
    // clear has made the vacancy visible.
    entityType: 'FACTION',
    entityId: faction.id,
    entityName: faction.name,
    field: 'leaderCharacterId',
    previousValue: faction.leaderCharacterId,
    newValue: 'none',
    description: leader
      ? `${leader.name} is dead; ${faction.name} released them as leader of record so a successor can be chosen`
      : `${faction.name} released a leader of record that no longer exists`,
    write: { model: 'faction', id: faction.id, data: { leaderCharacterId: null } },
  }
}
