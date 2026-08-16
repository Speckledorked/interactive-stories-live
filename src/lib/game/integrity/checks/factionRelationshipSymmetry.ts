// src/lib/game/integrity/checks/factionRelationshipSymmetry.ts
// #403: "if A calls B a rival, B calls A a rival."
//
// Faction.relationships is a JSON map and three layers disagreed about
// whether it is symmetric:
//
//   - relationshipEngine.ts writes BOTH sides (aTies[b.id] and bTies[a.id]).
//   - warTick.ts reads ONE side, via findRivalId.
//   - the integrity engine repaired relationship keys non-symmetrically,
//     so a repaired row could leave the two directions disagreeing.
//
// Symmetry was therefore a property of the DATA enforced only by the one
// writer that happens to do it. Any other path — an admin route, an
// integrity repair, an AI-driven relationship change, an import — produces
// a legal-looking asymmetric map that no reader detects, and findRivalId
// then makes a load-bearing decision (who a war ignites against) out of it.
//
// A grep for "symmetr" or "reciproc" across the repository used to return
// nothing at all. This is that missing invariant, checked rather than
// assumed.
//
// Repairing it means choosing which side is right, and there is no general
// answer — one side may be a stale leftover and the other current, or vice
// versa. So this is DETECT-ONLY, the same posture the engine already takes
// for duplicate names and clocks tied to a collapsed faction: reported to
// admin, never silently resolved by picking a side.

import { relationshipAsymmetries } from '../../tick/types'
import { IntegrityCheck, IntegritySnapshot, Violation } from '../types'
import { CheckKey } from '../checkKeys'

export const factionRelationshipsAreSymmetric: IntegrityCheck = {
  key: 'faction.relationships.symmetric' satisfies CheckKey,
  description: 'A faction relationship should read the same from both sides',
  run(snapshot: IntegritySnapshot): Violation[] {
    return relationshipAsymmetries(snapshot.factions).map((problem) => {
      const faction = snapshot.factions.find((f) => f.id === problem.factionId)
      const other = snapshot.factions.find((f) => f.id === problem.otherId)
      const otherName = other?.name ?? problem.otherId
      return {
        checkKey: 'faction.relationships.symmetric',
        entityType: 'FACTION' as const,
        entityId: problem.factionId,
        entityName: faction?.name ?? problem.factionId,
        description:
          problem.otherType === null
            ? `${faction?.name ?? problem.factionId} records ${otherName} as ${problem.type}, but ${otherName} has no relationship on record with them`
            : `${faction?.name ?? problem.factionId} records ${otherName} as ${problem.type}, but ${otherName} records them as ${problem.otherType}`,
      }
    })
  },
}
