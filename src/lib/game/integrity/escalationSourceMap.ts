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
  // blob"). All four write through resolveEntityByNameOrId today; a
  // recurrence means some new write path started skipping it again.
  'character.relationships.keys.resolve': ['src/lib/game/worldUpdaters/characters.ts'],
  'npc.socialTies.keys.resolve': ['src/lib/game/tick/npcSocietyTick.ts'],
  'faction.relationships.keys.resolve': ['src/lib/game/tick/relationshipTick.ts'],
  'character.resources.reputation.keys.resolve': ['src/lib/game/questRewards.ts'],

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
} as const

/** Whether Phase 5 has anywhere to attribute a fix attempt for this
 * checkKey. False is the safe default. */
export function hasAttributedSource(checkKey: string): boolean {
  return checkKey in ESCALATION_SOURCE_FILES
}
