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

/** Pure decision function — no DB access, safe to unit test directly. */
export function decideTerritoryClaim(
  locations: TerritoryView[],
  claimantFactionId: string,
  rivalFactionIds: string[]
): TerritoryClaimAction {
  // Deterministic ordering — same world state always claims the same place.
  const sorted = [...locations].sort((a, b) => a.name.localeCompare(b.name))

  const contestedRivalLand = sorted.find(
    (l) => l.isContested && l.ownerFactionId !== null && l.ownerFactionId !== claimantFactionId
  )
  if (contestedRivalLand) {
    return {
      kind: 'conquer',
      locationId: contestedRivalLand.id,
      locationName: contestedRivalLand.name,
      fromFactionId: contestedRivalLand.ownerFactionId,
    }
  }

  const unowned = sorted.find((l) => l.ownerFactionId === null)
  if (unowned) {
    return { kind: 'settle', locationId: unowned.id, locationName: unowned.name }
  }

  const rivalLand = sorted.find(
    (l) => l.ownerFactionId !== null && rivalFactionIds.includes(l.ownerFactionId) && !l.isContested
  )
  if (rivalLand) {
    return { kind: 'contest', locationId: rivalLand.id, locationName: rivalLand.name, ownerFactionId: rivalLand.ownerFactionId! }
  }

  return { kind: 'none' }
}
