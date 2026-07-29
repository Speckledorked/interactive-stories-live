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

import { decideSuccession } from '../../tick/leadershipTick'
import { IntegrityCheck, IntegritySnapshot, Repair, RepairFn, Violation } from '../types'
import { isRuleActive, ruleFor } from '../worldRules'

function membersFor(snapshot: IntegritySnapshot, factionId: string) {
  return snapshot.npcs
    .filter((npc) => npc.isAlive && npc.factionId === factionId)
    .map((npc) => ({ id: npc.id, name: npc.name, importance: npc.importance, factionRole: npc.factionRole }))
}

export const factionHasOneLivingLeader: IntegrityCheck = {
  key: 'faction.leadership.exactlyOneLivingLeader',
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
