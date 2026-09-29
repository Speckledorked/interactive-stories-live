// src/lib/game/integrity/checkRegistry.ts
// The closed catalogue of structural-tier checks (Phase 1) and their
// repairs. "Closed" is the operative word — see Phase 4 of the plan: this
// registry is the fixed set of things the engine can ever detect or fix in
// this tier; nothing outside it is invented at runtime.

import { REFERENTIAL_INTEGRITY_CHECKS } from './checks/referentialIntegrity'
import { REFERENTIAL_INTEGRITY_REPAIRS } from './repairs/referentialIntegrity'
import {
  factionHasOneLivingLeader,
  repairFactionLeadership,
  factionHasAtMostOneLivingLeader,
  repairFactionLeadershipConflict,
  factionLeaderCharacterIsAlive,
  repairFactionLeaderCharacterAlive,
} from './checks/factionLeadership'
import { DUPLICATE_NAME_CHECKS } from './checks/duplicateNames'
import { factionRelationshipsAreSymmetric } from './checks/factionRelationshipSymmetry'
import { IntegrityCheck, RepairFn } from './types'

export const INTEGRITY_CHECKS: IntegrityCheck[] = [
  ...REFERENTIAL_INTEGRITY_CHECKS,
  // #476: before the two below, deliberately. A stale leaderCharacterId is
  // exactly what makes both of them read "nothing to do", so clearing it
  // has to get first crack at the pass's repair budget.
  factionLeaderCharacterIsAlive,
  factionHasOneLivingLeader,
  factionHasAtMostOneLivingLeader,
  ...DUPLICATE_NAME_CHECKS,
  // #403: detect-only. Repairing an asymmetry means choosing which side
  // is right, and there is no general answer — see the check's own header.
  factionRelationshipsAreSymmetric,
]

/** checkKey -> repair function. A check with no entry is detect-only by
 * design (duplicate names, a clock still tied to a collapsed faction) —
 * see the doc comment on REFERENTIAL_INTEGRITY_REPAIRS for what that means
 * for reporting. */
export const INTEGRITY_REPAIRS: Record<string, RepairFn> = {
  ...REFERENTIAL_INTEGRITY_REPAIRS,
  'faction.leaderCharacterId.alive': repairFactionLeaderCharacterAlive,
  'faction.leadership.exactlyOneLivingLeader': repairFactionLeadership,
  'faction.leadership.atMostOneLivingLeader': repairFactionLeadershipConflict,
}
