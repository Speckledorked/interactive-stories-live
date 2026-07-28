// src/lib/game/integrity/checkRegistry.ts
// The closed catalogue of structural-tier checks (Phase 1) and their
// repairs. "Closed" is the operative word — see Phase 4 of the plan: this
// registry is the fixed set of things the engine can ever detect or fix in
// this tier; nothing outside it is invented at runtime.

import { REFERENTIAL_INTEGRITY_CHECKS } from './checks/referentialIntegrity'
import { REFERENTIAL_INTEGRITY_REPAIRS } from './repairs/referentialIntegrity'
import { factionHasOneLivingLeader, repairFactionLeadership } from './checks/factionLeadership'
import { DUPLICATE_NAME_CHECKS } from './checks/duplicateNames'
import { IntegrityCheck, RepairFn } from './types'

export const INTEGRITY_CHECKS: IntegrityCheck[] = [
  ...REFERENTIAL_INTEGRITY_CHECKS,
  factionHasOneLivingLeader,
  ...DUPLICATE_NAME_CHECKS,
]

/** checkKey -> repair function. A check with no entry is detect-only by
 * design (duplicate names, a clock still tied to a collapsed faction) —
 * see the doc comment on REFERENTIAL_INTEGRITY_REPAIRS for what that means
 * for reporting. */
export const INTEGRITY_REPAIRS: Record<string, RepairFn> = {
  ...REFERENTIAL_INTEGRITY_REPAIRS,
  'faction.leadership.exactlyOneLivingLeader': repairFactionLeadership,
}
