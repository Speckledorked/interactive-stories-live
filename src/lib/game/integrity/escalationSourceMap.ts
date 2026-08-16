// src/lib/game/integrity/escalationSourceMap.ts
// Phase 5 (design, plan section 5c) — a small, hand-maintained registry
// mapping a checkKey to the source file(s) most likely responsible when
// its violations RECUR after repair (an escalation, see escalation.ts).
//
// checkKey alone says WHAT broke, never WHERE to fix it. Finding that
// automatically (bisecting WorldEvent history by actor, say) is real
// engineering for a signal this rare — cheaper and more in keeping with
// this plan's "closed catalogue, human-reviewed" philosophy to declare it
// once, by hand, when the check is authored.
//
// A checkKey with NO entry here is a legitimate, safe steady state: it
// means the engine can characterize an escalation on that checkKey (Phase
// 1c already does, for every checkKey) but Phase 5's future fix-generation
// step has nowhere attributed to start from and will not attempt one —
// same "detect-only is a real answer" shape INTEGRITY_REPAIRS already
// uses for a checkKey with no repair function.

import { CheckKey } from './checkKeys'

export const ESCALATION_SOURCE_FILES: Readonly<Partial<Record<CheckKey, readonly string[]>>> = {
  // Phase 0's original bug, and the shape every other id-keyed-JSON-blob
  // check shares (1d: "same technique covers every other id-keyed JSON
  // blob"). Writes through resolveEntityByNameOrId today; a recurrence
  // means some new write path started skipping it again.
  //
  // #373: npc.socialTies and faction.relationships used to be listed here
  // too. Attribution implies "this can recur after a real fix", and those
  // two cannot recur from application code any more — they are FK'd edge
  // rows, so a recurrence would mean the CONSTRAINT regressed, not that a
  // handler started writing bad keys. Attributing them to a tick handler
  // would point an admin at the wrong file.
  'character.relationships.keys.resolve': ['src/lib/game/worldUpdaters/characters.ts'],

  // Phase 0's other original bug. The FK (Phase 0 migration) makes this
  // structurally impossible today, so a recurrence would mean the
  // constraint itself regressed — attributed to the schema and the one
  // application-level guard that used to matter before the FK existed.
  'war.contestedLocationId.resolves': ['src/lib/game/tick/warTick.ts', 'prisma/schema.prisma'],

  // Same dangling-array-of-ids shape as the FK case above, minus the FK —
  // Clock.participantNpcIds is a raw String[], so this one IS still a live
  // risk, not just a regression guard.
  'clock.participantNpcIds.resolve': ['src/lib/game/tick/npcSocietyTick.ts'],

  // debt.counterpartyId.resolves, clock.sourceFactionId.active,
  // faction.leadership.exactlyOneLivingLeader,
  // faction.leadership.atMostOneLivingLeader (#275), and the three
  // *.name.unique checks are DELIBERATELY ABSENT — see oracleTechnique.ts
  // for why each one is a poor fit for automated fix-generation even
  // though some of them have a data repair (Phase 1) or a mechanical
  // oracle (Phase 1d) already.
  //
  // character.resources.reputation.keys.resolve is ALSO deliberately
  // absent, for a different reason than the above five: this attribution
  // used to point at questRewards.ts, but that's stale — the AI-facing
  // `reputation_changes` field was removed in favor of `standing_changes`
  // writing to the relational FactionStanding table instead (see
  // standing.ts), which resolves its faction reference through a real
  // `db.faction.findFirst` lookup before ever writing, and is further
  // guarded by an actual FK constraint (`onDelete: Cascade`) — structurally
  // immune to the orphan-key shape this map exists to attribute. No code
  // path writes a fresh violation into Character.resources.reputation
  // anymore; repairCharacterReputation (Phase 1) still runs and still
  // matters, but only to clean up rows that predate that migration. An
  // escalation here would mean stale legacy data, not a live regressing
  // bug — nothing for Phase 5 to attribute a fix attempt to.
} as const

/** Whether Phase 5 has anywhere to attribute a fix attempt for this
 * checkKey. False is the safe default. */
export function hasAttributedSource(checkKey: string): boolean {
  return checkKey in ESCALATION_SOURCE_FILES
}
