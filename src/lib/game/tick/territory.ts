// src/lib/game/tick/territory.ts
// World Sim Phase 4 — territory: which faction controls which Location.
//
// This module is only the pure decision logic. The DB writes happen where
// the triggering events already live: a successful EXPAND ambition claims
// ground and a successful DESTABILIZE_RIVAL contests it in worldTurn.ts's
// resolveCompletedAmbitions; faction collapse hands territory to the
// absorber/successor in factionTick.ts. There is deliberately no separate
// per-turn "territory tick" — land doesn't change hands on idle drift, only
// when something actually happens.
//
// Escalation ladder for a successful EXPAND, in order:
//   1. Conquer: a location the claimant already contested falls to it.
//   2. Settle: unowned land gets claimed outright.
//   3. Contest: a rival's location becomes contested — the foothold that
//      makes a future EXPAND a conquest instead of a coin-flip land grab.
// So taking a rival's territory always takes two successful EXPANDs, not
// one: pressure first, conquest second.
//
// World Sim #108: within EACH tier above, which one of several tied
// candidates gets picked is now real nearest-neighbor selection (via
// worldGraph.ts's shortestPath) from the claimant's home base, when
// adjacency data exists — instead of always the alphabetically-first
// candidate. Adjacency is OPTIONAL input, not a dependency: omitted (or a
// candidate unreachable in the graph), the tier falls back to the exact
// same alphabetical-first pick as before #108, so a campaign with no
// backfilled graph yet behaves identically to pre-#108 code.

import { AdjacencyEdge, nearestLocation } from '../worldGraph'

export interface TerritoryView {
  id: string
  name: string
  ownerFactionId: string | null
  isContested: boolean
}

export type TerritoryClaimAction =
  | { kind: 'conquer'; locationId: string; locationName: string; fromFactionId: string | null }
  | { kind: 'settle'; locationId: string; locationName: string }
  | { kind: 'contest'; locationId: string; locationName: string; ownerFactionId: string }
  | { kind: 'none' }

export interface TerritoryAdjacencyContext {
  edges: AdjacencyEdge[]
  /** The claimant's own "home" location (e.g. its first-owned territory) —
   * null when the faction owns nothing yet or none is known, in which case
   * every tier below falls back to alphabetical-first regardless of edges. */
  homeLocationId: string | null
}

/** Picks the nearest-to-home candidate when adjacency data can decide it,
 * otherwise the first candidate in (already alphabetically-sorted) order —
 * identical to this module's pre-#108 `.find()` behavior. */
function pickCandidate(candidates: TerritoryView[], adjacency?: TerritoryAdjacencyContext): TerritoryView | undefined {
  if (candidates.length === 0) return undefined
  if (candidates.length > 1 && adjacency?.homeLocationId && adjacency.edges.length > 0) {
    const nearest = nearestLocation(
      adjacency.edges,
      adjacency.homeLocationId,
      candidates.map((c) => c.id)
    )
    if (nearest) {
      const match = candidates.find((c) => c.id === nearest.locationId)
      if (match) return match
    }
  }
  return candidates[0]
}

/** Pure decision function — no DB access, safe to unit test directly. */
export function decideTerritoryClaim(
  locations: TerritoryView[],
  claimantFactionId: string,
  rivalFactionIds: string[],
  adjacency?: TerritoryAdjacencyContext
): TerritoryClaimAction {
  // Deterministic ordering — same world state always claims the same place
  // (and is what pickCandidate falls back to when adjacency can't decide).
  const sorted = [...locations].sort((a, b) => a.name.localeCompare(b.name))

  const contestedRivalLand = pickCandidate(
    sorted.filter((l) => l.isContested && l.ownerFactionId !== null && l.ownerFactionId !== claimantFactionId),
    adjacency
  )
  if (contestedRivalLand) {
    return {
      kind: 'conquer',
      locationId: contestedRivalLand.id,
      locationName: contestedRivalLand.name,
      fromFactionId: contestedRivalLand.ownerFactionId,
    }
  }

  const unowned = pickCandidate(
    sorted.filter((l) => l.ownerFactionId === null),
    adjacency
  )
  if (unowned) {
    return { kind: 'settle', locationId: unowned.id, locationName: unowned.name }
  }

  const rivalLand = pickCandidate(
    sorted.filter((l) => l.ownerFactionId !== null && rivalFactionIds.includes(l.ownerFactionId) && !l.isContested),
    adjacency
  )
  if (rivalLand) {
    return { kind: 'contest', locationId: rivalLand.id, locationName: rivalLand.name, ownerFactionId: rivalLand.ownerFactionId! }
  }

  return { kind: 'none' }
}
