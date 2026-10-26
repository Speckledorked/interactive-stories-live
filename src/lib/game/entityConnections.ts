// src/lib/game/entityConnections.ts
//
// The live CONNECTIONS behind a /world entity card (#521).
//
// entityStats.ts shipped the numbers the tick moves each turn. This is its
// counterpart for the relational state the tick moves — the four tables
// that had, between them, zero API routes and zero components:
//
//   NpcTie                 tick/npcSocietyTick.ts    who an NPC knows
//   FactionDebt            tick/economyTick.ts       who owes whom
//   SupplyRoute            tick/logisticsTick.ts     what can still move
//   PopulationFlightEvent  tick/migrationTick.ts     who is leaving
//
// All four were load-bearing for the simulation and invisible to the
// player. logisticsTick's own module doc records the sharper version of
// the same problem: SupplyRoute rows were never created by anything for a
// whole release, so "the mechanic shipped inert" — and a blockade is real
// state today that still nobody can look at.
//
// Pure and side-effect free, exactly like entityStats.ts: the route hands
// these functions rows it has already fog-of-war filtered, and the
// component renders what comes back.
//
// Role-awareness follows #389's settled doctrine rather than re-deciding
// it. An ADMIN gets the simulation as it is; a PLAYER gets the fiction.
// For a debt that means the band always, and the integer only for an
// admin — a banded debt amount would be a number with no honest reading,
// where a banded stability score at least has a meter to sit in.

export type TieKind = 'ALLY' | 'RIVAL'

export type NpcConnections = {
  kind: 'NPC'
  /** Names of other DISCOVERED NPCs only. */
  allies: string[]
  rivals: string[]
}

export type FactionDebtEntry = {
  /** The other party. */
  faction: string
  /** Diegetic weight — the only form a player ever sees. */
  weight: string
  /** Raw amount for an ADMIN, null for a PLAYER. */
  amount: number | null
}

export type FactionConnections = {
  kind: 'FACTION'
  /** Debts this faction owes to others. */
  owes: FactionDebtEntry[]
  /** Debts others owe to this faction. */
  owed: FactionDebtEntry[]
}

export type SupplyRouteEntry = {
  /** The location at the other end. */
  to: string
  blockaded: boolean
}

export type LocationConnections = {
  kind: 'LOCATION'
  /** Routes touching this location, either direction. */
  routes: SupplyRouteEntry[]
  /** True when every route touching this location is blockaded and there
   *  is at least one — the state that actually starves a place. */
  cutOff: boolean
  /** Where people have recently fled to, most recent first. */
  fleeingTo: string[]
}

export type EntityConnections = NpcConnections | FactionConnections | LocationConnections

/**
 * Diegetic weight for a faction debt.
 *
 * The thresholds track the mechanic rather than being picked for feel:
 * economyTick.ts repays DEBT_REPAYMENT_PER_TICK (10) per turn out of a
 * 0-100 resource pool, so one band is "clears within a turn or two",
 * the next is "clears within a handful", and the last is "not getting
 * out of this soon". Restated here rather than imported, because a pure
 * display module importing a tick handler is the wrong direction — if
 * that constant moves, this comment is the thing that should be checked.
 */
export function describeDebtWeight(amount: number): string {
  if (amount <= 10) return 'Nearly settled'
  if (amount <= 30) return 'Weighty'
  return 'Crushing'
}

/** Build the NPC card's tie payload, naming only NPCs the party has found. */
export function npcConnectionsFor(
  ties: Array<{ otherId: string; type: TieKind }>,
  discoveredNpcNameById: Map<string, string>
): NpcConnections {
  const allies: string[] = []
  const rivals: string[] = []
  for (const tie of ties) {
    // Fog of war on the OTHER end of the edge. An NPC's tie to someone
    // undiscovered is dropped entirely rather than rendered anonymously:
    // "an ally you have not met" still reveals that they have one, which
    // is a fact about an entity the party has not found.
    const name = discoveredNpcNameById.get(tie.otherId)
    if (!name) continue
    ;(tie.type === 'ALLY' ? allies : rivals).push(name)
  }
  allies.sort()
  rivals.sort()
  return { kind: 'NPC', allies, rivals }
}

/** Build the FACTION card's debt payload for a given role. */
export function factionConnectionsFor(
  role: 'ADMIN' | 'PLAYER',
  factionId: string,
  debts: Array<{
    creditorFactionId: string
    debtorFactionId: string
    amount: number
  }>,
  visibleFactionNameById: Map<string, string>
): FactionConnections {
  const owes: FactionDebtEntry[] = []
  const owed: FactionDebtEntry[] = []

  for (const debt of debts) {
    const isDebtor = debt.debtorFactionId === factionId
    const otherId = isDebtor ? debt.creditorFactionId : debt.debtorFactionId
    // Same reasoning as the NPC side: a debt to an undiscovered faction is
    // dropped, not anonymised.
    const other = visibleFactionNameById.get(otherId)
    if (!other) continue

    const entry: FactionDebtEntry = {
      faction: other,
      weight: describeDebtWeight(debt.amount),
      amount: role === 'ADMIN' ? debt.amount : null,
    }
    ;(isDebtor ? owes : owed).push(entry)
  }

  return { kind: 'FACTION', owes, owed }
}

/** Build the LOCATION card's logistics payload. */
export function locationConnectionsFor(
  locationId: string,
  routes: Array<{
    fromLocationId: string
    toLocationId: string
    isBlockaded: boolean
  }>,
  flights: Array<{ toLocationId: string }>,
  visibleLocationNameById: Map<string, string>
): LocationConnections {
  const entries: SupplyRouteEntry[] = []
  for (const route of routes) {
    const otherId = route.fromLocationId === locationId ? route.toLocationId : route.fromLocationId
    const other = visibleLocationNameById.get(otherId)
    if (!other) continue
    entries.push({ to: other, blockaded: route.isBlockaded })
  }
  entries.sort((a, b) => a.to.localeCompare(b.to))

  // Computed from the routes that SURVIVED the fog filter, which is the
  // honest reading: "everything you know about is cut" is what the party
  // can actually observe. A hidden open route elsewhere is not something
  // they could know, and claiming otherwise either way would be a guess.
  const cutOff = entries.length > 0 && entries.every((r) => r.blockaded)

  // Flight rows carry a denormalized destination name (toLocationName).
  // It is deliberately neither taken nor selected: the row was written
  // when the place may have been visible, so reading the stored name
  // would be a way around the fog. The id is resolved through the index.
  const fleeingTo: string[] = []
  for (const flight of flights) {
    const name = visibleLocationNameById.get(flight.toLocationId)
    if (!name || fleeingTo.includes(name)) continue
    fleeingTo.push(name)
  }

  return { kind: 'LOCATION', routes: entries, cutOff, fleeingTo }
}
