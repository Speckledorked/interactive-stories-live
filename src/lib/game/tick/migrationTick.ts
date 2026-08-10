// src/lib/game/tick/migrationTick.ts
// World Sim #110 — migration & population flows.
//
// Hard dependency on #109 (Location.conditionScore): distress is defined by
// the same score locationConditionTick.ts already drifts, not a new signal
// invented for this. Two related but separate effects, both deterministic
// and bounded:
//
// 1. Named NPCs actually flee a distressed location for the healthiest
//    viable destination — a small, capped number per source location per
//    tick, so a single catastrophic location doesn't relocate its entire
//    cast in one pass.
// 2. Background population (Location.population — nullable, opt-in; see
//    schema.prisma) drifts the same direction for any location that
//    tracks it, representing residents who were never modeled as
//    individual NPC rows.
//
// Runs after tickNpcs (see worldTick.ts's TICK_HANDLERS) so this reads
// NPCs at their POST-commute location for this same turn, not last turn's.
//
// #108 follow-up (this codebase's own architecture audit): destination
// selection originally picked the single highest-condition location
// CAMPAIGN-WIDE, with no regard for whether refugees could actually reach
// it — a location on the far, disconnected side of the map could "win"
// over a genuinely nearby haven. Now prefers the highest-condition
// REACHABLE destination via the real adjacency graph (worldGraph.ts),
// falling back to the old campaign-wide pick when this campaign has no
// graph data covering the source location — adjacency-AWARE, not
// adjacency-DEPENDENT, same convention as every other #108 consumer.

import { TickContext, TickHandlerResult, WorldChange } from './types'
import { AdjacencyEdge, shortestPath } from '../worldGraph'

// RUINED/ABANDONED band boundary — the same bar
// locationConditionTick.ts's SITE_CONDITION_PENALTY_THRESHOLD (resolution.ts)
// uses for "this place is falling apart," reused here rather than inventing
// a second distress threshold for the same score.
const DISTRESS_THRESHOLD = 25
// STABLE band or better — nowhere below this counts as "somewhere better."
const VIABLE_THRESHOLD = 50
// Bounded per distressed source location per tick — named NPCs are a
// scarce, cast-defining resource; letting one bad tick empty a location's
// entire population of them would be a much bigger narrative event than
// "the place is struggling."
const MAX_NPC_MIGRATIONS_PER_LOCATION = 3
// Fraction of a distressed location's tracked population that flees per
// tick, floored at 1 so a small population doesn't round down to nothing
// forever.
const POPULATION_FLIGHT_FRACTION = 0.1

export interface MigrationDecision {
  npcId: string
  npcName: string
  fromLocationId: string
  fromLocationName: string
  toLocationId: string
  toLocationName: string
}

export interface PopulationShiftDecision {
  locationId: string
  locationName: string
  previousPopulation: number
  newPopulation: number
}

export interface DistressedLocationInput {
  id: string
  name: string
  conditionScore: number
  population: number | null
}

export interface DestinationLocationInput {
  id: string
  name: string
  conditionScore: number
  population: number | null
}

export interface MigratingNpcInput {
  id: string
  name: string
  locationId: string | null
  isAlive: boolean
}

/**
 * The highest-condition destination reachable from `locationId` via the
 * real adjacency graph, or — when `edges` is empty or none of the
 * candidates are reachable in it (no graph data covers this campaign or
 * this location yet) — the highest-condition destination campaign-wide,
 * exactly like before #108. `sortedDestinations` is already
 * highest-condition-first, so both branches just take the first match.
 */
function pickDestination(
  locationId: string,
  sortedDestinations: DestinationLocationInput[],
  edges: AdjacencyEdge[]
): DestinationLocationInput | null {
  const candidates = sortedDestinations.filter((d) => d.id !== locationId)
  if (candidates.length === 0) return null
  if (edges.length === 0) return candidates[0]

  const reachable = candidates.filter((d) => shortestPath(edges, locationId, d.id) !== null)
  return reachable.length > 0 ? reachable[0] : candidates[0]
}

/**
 * Pure decision function — no DB access, safe to unit test directly.
 *
 * `distressedLocations` and `candidateDestinations` are expected to already
 * be filtered to below/at-or-above the thresholds above (the DB handler
 * does this at query time); this function re-checks conditionScore anyway
 * so it stays correct if ever called with an unfiltered list. `edges`
 * defaults to empty (campaign-wide selection, pre-#108 behavior) for any
 * caller that doesn't have graph data on hand.
 */
export function decideMigration(
  distressedLocations: DistressedLocationInput[],
  candidateDestinations: DestinationLocationInput[],
  npcs: MigratingNpcInput[],
  edges: AdjacencyEdge[] = []
): { npcMoves: MigrationDecision[]; populationShifts: PopulationShiftDecision[] } {
  const npcMoves: MigrationDecision[] = []

  if (candidateDestinations.length === 0) {
    return { npcMoves, populationShifts: [] }
  }

  // Highest-condition destination wins, deterministically — ties broken by
  // id so the result never depends on query row order.
  const sortedDestinations = [...candidateDestinations].sort(
    (a, b) => b.conditionScore - a.conditionScore || a.id.localeCompare(b.id)
  )

  const nameById = new Map<string, string>()
  const workingPopulation = new Map<string, number>()
  for (const loc of [...distressedLocations, ...candidateDestinations]) {
    nameById.set(loc.id, loc.name)
    if (loc.population !== null) workingPopulation.set(loc.id, loc.population)
  }

  for (const location of distressedLocations) {
    if (location.conditionScore >= DISTRESS_THRESHOLD) continue
    const destination = pickDestination(location.id, sortedDestinations, edges)
    if (!destination) continue

    const residents = npcs.filter((npc) => npc.isAlive && npc.locationId === location.id)
    for (const npc of residents.slice(0, MAX_NPC_MIGRATIONS_PER_LOCATION)) {
      npcMoves.push({
        npcId: npc.id,
        npcName: npc.name,
        fromLocationId: location.id,
        fromLocationName: location.name,
        toLocationId: destination.id,
        toLocationName: destination.name,
      })
    }

    const sourcePopulation = workingPopulation.get(location.id)
    if (sourcePopulation !== undefined && sourcePopulation > 0) {
      const fleeing = Math.max(1, Math.round(sourcePopulation * POPULATION_FLIGHT_FRACTION))
      workingPopulation.set(location.id, Math.max(0, sourcePopulation - fleeing))
      const destPopulation = workingPopulation.get(destination.id)
      if (destPopulation !== undefined) {
        workingPopulation.set(destination.id, destPopulation + fleeing)
      }
    }
  }

  const initialById = new Map<string, number>()
  for (const loc of [...distressedLocations, ...candidateDestinations]) {
    if (loc.population !== null) initialById.set(loc.id, loc.population)
  }

  const populationShifts: PopulationShiftDecision[] = []
  for (const [id, newPopulation] of workingPopulation) {
    const previousPopulation = initialById.get(id)!
    if (newPopulation !== previousPopulation) {
      populationShifts.push({
        locationId: id,
        locationName: nameById.get(id)!,
        previousPopulation,
        newPopulation,
      })
    }
  }

  return { npcMoves, populationShifts }
}

export async function tickMigration(ctx: TickContext): Promise<TickHandlerResult> {
  const locations = await ctx.db.location.findMany({
    where: { campaignId: ctx.campaignId, isDiscovered: true },
    select: { id: true, name: true, conditionScore: true, population: true },
  })

  const distressedLocations = locations.filter((l) => l.conditionScore < DISTRESS_THRESHOLD)
  if (distressedLocations.length === 0) return { changes: [] }

  const candidateDestinations = locations.filter((l) => l.conditionScore >= VIABLE_THRESHOLD)
  if (candidateDestinations.length === 0) return { changes: [] }

  const [npcs, adjacencyRows] = await Promise.all([
    ctx.db.nPC.findMany({
      where: {
        campaignId: ctx.campaignId,
        isAlive: true,
        locationId: { in: distressedLocations.map((l) => l.id) },
      },
      select: { id: true, name: true, locationId: true, isAlive: true, importance: true },
    }),
    // #108: optional input to pickDestination — falls back to the
    // pre-#108 campaign-wide highest-condition pick when this is empty or
    // doesn't cover a given distressed location.
    ctx.db.locationAdjacency.findMany({
      where: { campaignId: ctx.campaignId },
      select: { locationAId: true, locationBId: true, distance: true },
    }),
  ])
  const importanceById = new Map(npcs.map((n) => [n.id, n.importance]))

  const { npcMoves, populationShifts } = decideMigration(
    distressedLocations,
    candidateDestinations,
    npcs,
    adjacencyRows as AdjacencyEdge[]
  )

  const changes: WorldChange[] = []

  for (const move of npcMoves) {
    if (!ctx.dryRun) {
      await ctx.db.nPC.update({
        where: { id: move.npcId },
        data: { locationId: move.toLocationId, currentLocation: move.toLocationName },
      })
    }
    // Same MAJOR/NORMAL split npcTick.ts already uses for a location move.
    const importance = importanceById.get(move.npcId) ?? 0
    changes.push({
      entityType: 'NPC',
      entityId: move.npcId,
      entityName: move.npcName,
      campaignId: ctx.campaignId,
      field: 'currentLocation',
      previousValue: move.fromLocationName,
      newValue: move.toLocationName,
      reason: `${move.npcName} fled the deteriorating conditions in ${move.fromLocationName} for ${move.toLocationName}`,
      significant: true,
      importance: importance >= 5 ? 'MAJOR' : 'NORMAL',
    })
  }

  for (const shift of populationShifts) {
    if (!ctx.dryRun) {
      await ctx.db.location.update({
        where: { id: shift.locationId },
        data: { population: shift.newPopulation },
      })
    }
    changes.push({
      entityType: 'LOCATION_POPULATION',
      entityId: shift.locationId,
      entityName: shift.locationName,
      campaignId: ctx.campaignId,
      field: 'population',
      previousValue: shift.previousPopulation,
      newValue: shift.newPopulation,
      reason:
        shift.newPopulation > shift.previousPopulation
          ? `${shift.locationName} absorbs refugees fleeing worse conditions elsewhere`
          : `${shift.locationName}'s population dwindles as residents flee its decline`,
      // Routine background drift, same as weatherTick's severity wobbles —
      // not worth a history/RAG entry on its own.
      significant: false,
      importance: 'NORMAL',
    })
  }

  return { changes }
}
