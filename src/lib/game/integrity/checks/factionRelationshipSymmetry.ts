// src/lib/game/integrity/checks/factionRelationshipSymmetry.ts
// #403: "if A calls B a rival, B calls A a rival."
//
// Faction.relationships was a JSON map and three layers disagreed about
// whether it was symmetric:
//
//   - relationshipEngine.ts wrote BOTH sides (aTies[b.id] and bTies[a.id]).
//   - warTick.ts read ONE side, via findRivalId.
//   - the integrity engine repaired relationship keys non-symmetrically,
//     so a repaired row could leave the two directions disagreeing.
//
// Symmetry was therefore a property of the DATA enforced only by the one
// writer that happened to do it. Any other path — an admin route, an
// integrity repair, an AI-driven relationship change, an import — produced
// a legal-looking asymmetric map that no reader detected, and findRivalId
// then made a load-bearing decision (who a war ignites against) out of it.
//
// #373 changed what this check is FOR. Ties are edge rows now: one
// canonical row per pair with `aId < bId`, enforced by a DB CHECK
// constraint (`FactionTie_canonical_order` / `NpcTie_canonical_order`) and
// a unique index on the ordered pair. An asymmetric relationship is no
// longer merely undetected-by-readers — it is unrepresentable, the same way
// war.contestedLocationId stopped being able to dangle once it got a real
// foreign key.
//
// So this became a REGRESSION GUARD, and the question it asks moved with
// the invariant: the property that now carries symmetry is the canonical
// ordering, so that is what is checked. A reversed pair, a self-edge, or
// two rows for one pair is what "asymmetric" looks like in the new shape,
// and all three mean the CHECK constraint was dropped by some later
// migration — caught here rather than by a reader silently disagreeing
// with itself mid-tick.
//
// Still DETECT-ONLY, for the same reason as before: repairing it means
// choosing which row is right, and there is no general answer.

import { tieOrderingViolations } from '../../tick/types'
import { IntegrityCheck, IntegritySnapshot, Violation } from '../types'
import { CheckKey } from '../checkKeys'

const PROBLEM_TEXT: Record<'reversed' | 'self' | 'duplicate', string> = {
  reversed: 'is stored with its endpoints in the wrong order',
  self: 'points a faction at itself',
  duplicate: 'is stored twice, so the two rows can disagree',
}

export const factionRelationshipsAreSymmetric: IntegrityCheck = {
  key: 'faction.relationships.symmetric' satisfies CheckKey,
  description: 'A faction relationship must be one canonically-ordered row per pair',
  run(snapshot: IntegritySnapshot): Violation[] {
    const nameById = new Map(snapshot.factions.map((f) => [f.id, f.name]))
    return tieOrderingViolations(snapshot.factionTies).map((problem) => {
      const aName = nameById.get(problem.aId) ?? problem.aId
      const bName = nameById.get(problem.bId) ?? problem.bId
      return {
        checkKey: 'faction.relationships.symmetric',
        entityType: 'FACTION' as const,
        entityId: problem.aId,
        entityName: aName,
        description: `The tie between ${aName} and ${bName} ${PROBLEM_TEXT[problem.problem]} — the canonical-ordering constraint is not holding`,
      }
    })
  },
}
