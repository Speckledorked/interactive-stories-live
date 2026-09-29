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

// roster-exempt: population movement is location-driven. The NPC/faction
// reads here identify who lives where, not who is being simulated this
// turn — a rostered subset would move some inhabitants of a location and
// leave others behind in the same emptying settlement.

import { TickContext, TickHandlerResult, WorldChange, band, findRivalId } from './types'
import { AdjacencyEdge, shortestPath } from '../worldGraph'
import { NEUTRAL_DISPOSITION, parseDisposition } from './npcDispositionTick'
import { isSevereWeather } from './weatherTick'
import { TIE_INCLUDE, factionTies } from '../tieGraph'
import type { EventWitnessDistortion, WeatherCondition } from '@prisma/client'

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
// NPC motivation model: below this selfPreservation, an NPC refuses to
// flee at all — stubbornness, denial, or a bond to the place that
// outweighs the danger — regardless of how many flight slots remain this
// tick. Deliberately low relative to NEUTRAL_DISPOSITION's 50, so only an
// NPC who has genuinely drifted toward recklessness is ever exempted, not
// the ordinary case.
const FLIGHT_STAY_THRESHOLD = 15

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

// #262: the actual per-tick flow (source -> destination, how many),
// captured at the point of decision rather than reconstructed from the
// net PopulationShiftDecision totals above — a destination absorbing
// refugees from two different distressed sources in the same tick would
// otherwise be indistinguishable from one source sending twice as many.
export interface PopulationFlightDecision {
  fromLocationId: string
  fromLocationName: string
  toLocationId: string
  toLocationName: string
  count: number
}

export interface DistressedLocationInput {
  id: string
  name: string
  conditionScore: number
  population: number | null
  /** Owning faction, when the location has one. Used to look up that
   * faction's rival — destinations owned by the rival take a −10 score
   * penalty, not an exclusion. Absent, no rival penalty applies
   * (pre-#17 behavior exactly). */
  ownerFactionId?: string | null
}

export interface DestinationLocationInput {
  id: string
  name: string
  conditionScore: number
  population: number | null
  /** Optional — when absent, no weather penalty applies (keeps the pre-weather behavior exactly). */
  weather?: WeatherCondition
  weatherSeverity?: number
  /** Owning faction, when the destination has one. Absent, no
   * rival-filtering and no owner-health penalty apply. */
  ownerFactionId?: string | null
  /**
   * The owning faction's resources/stability. Refugees read the room: a
   * destination whose owner is LOW on either counts as less desirable —
   * a well-kept town owned by a starving, crumbling faction is a haven
   * with an expiry date. Each LOW band costs 15 score points via
   * destinationScore below. Absent (or ownerless), no penalty —
   * pre-#11 behavior exactly.
   */
  ownerFactionResources?: number | null
  ownerFactionStability?: number | null
}

// A rumor of doom stays actionable for this many turns after the NPC
// hears it — long enough to act on, short enough that stale gossip dies.
const HEARSAY_DOOM_TURNS = 10
// A single flight of this many people or more is newsworthy —
// informationTick picks it up as a rumor (significant WorldChange), while
// smaller flows stay routine background drift.
const FLIGHT_RUMOR_THRESHOLD = 10

export interface MigratingNpcInput {
  id: string
  name: string
  locationId: string | null
  isAlive: boolean
  /** NPC motivation model — optional, falls back to NEUTRAL_DISPOSITION.selfPreservation (50) when absent. Higher flees sooner; below FLIGHT_STAY_THRESHOLD, an NPC never flees at all. */
  selfPreservation?: number
  /** Affiliated faction, when the NPC has one. Destinations owned by
   * their faction's RIVAL take a −10 score penalty. Absent, only the
   * source location's owner-rival penalty applies. */
  factionId?: string | null
}

function selfPreservationOf(npc: MigratingNpcInput): number {
  return npc.selfPreservation ?? NEUTRAL_DISPOSITION.selfPreservation
}

/** Pure — 1 when the destination is in severe weather, else 0. Used as a
 * sort penalty so blizzard havens lose ties to clear-weather ones. */
export function weatherPenalty(destination: DestinationLocationInput): number {
  return destination.weather !== undefined &&
    isSevereWeather(destination.weather, destination.weatherSeverity ?? 0)
    ? 1
    : 0
}

/** Pure — how many of the owning faction's health signals are LOW (0-2).
 * A destination with no owner (or no owner health supplied) scores 0, so
 * the sort below degrades to its exact pre-#11 order. */
export function ownerDistressPenalty(destination: DestinationLocationInput): number {
  let penalty = 0
  if (destination.ownerFactionResources != null && band(destination.ownerFactionResources) === 'LOW') penalty++
  if (destination.ownerFactionStability != null && band(destination.ownerFactionStability) === 'LOW') penalty++
  return penalty
}

/** Pure — how much a refugee values a destination: its own condition
 * score, minus 15 for every LOW health signal on its owning faction (a
 * haven whose owner is starving or crumbling has an expiry date), minus
 * 10 when the destination is owned by the fleeing party's faction's rival
 * (refugees would rather not flee into the rival's arms — a preference,
 * not a veto). Exported for unit tests. */
export function destinationScore(d: DestinationLocationInput, rivalId?: string | null): number {
  return (
    d.conditionScore -
    15 * ownerDistressPenalty(d) -
    (rivalId && d.ownerFactionId === rivalId ? 10 : 0)
  )
}

/**
 * Pure — what an NPC believes a heard condition score was. Distortion
 * shifts the PERCEIVED score: EXAGGERATED rumors sound worse than truth
 * (perceived −20), MINIMIZED rumors sound better (perceived +20); other
 * flavors (GARBLED_DETAIL, ATTRIBUTED_WRONG) don't move the score.
 * Undistorted rows report the true value. Doom is tested against the
 * perceived score — the NPC acts on what they believe they heard, not
 * the ground truth. Exported for unit tests.
 */
export function perceivedConditionScore(
  actualScore: number,
  distorted: boolean,
  distortionFlavor: EventWitnessDistortion | null | undefined
): number {
  if (!distorted) return actualScore
  if (distortionFlavor === 'EXAGGERATED') return actualScore - 20
  if (distortionFlavor === 'MINIMIZED') return actualScore + 20
  return actualScore
}

/**
 * The highest-scoring destination reachable from `locationId` via the
 * real adjacency graph, or — when `edges` is empty or none of the
 * candidates are reachable in it (no graph data covers this campaign or
 * this location yet) — the highest-scoring destination campaign-wide,
 * exactly like before #108. Both branches just take the first match of
 * the rival-aware sort.
 *
 * `rivalId` applies the rival penalty inside destinationScore (refugees
 * avoid the rival's ground as a preference, not a veto: when every
 * viable destination is rival-owned, the best of them still wins).
 * `sortedByRival` memoizes the sort per rivalId — the caller loops many
 * locations but sorts at most once per distinct rival.
 */
function pickDestination(
  locationId: string,
  candidateDestinations: DestinationLocationInput[],
  edges: AdjacencyEdge[],
  sortedByRival: Map<string | null, DestinationLocationInput[]>,
  rivalId?: string | null
): DestinationLocationInput | null {
  const key = rivalId ?? null
  let sortedDestinations = sortedByRival.get(key)
  if (!sortedDestinations) {
    sortedDestinations = [...candidateDestinations].sort(
      (a, b) =>
        destinationScore(b, rivalId) - destinationScore(a, rivalId) ||
        weatherPenalty(a) - weatherPenalty(b) ||
        a.id.localeCompare(b.id)
    )
    sortedByRival.set(key, sortedDestinations)
  }
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
 *
 * `hearsayDoom` maps npcId -> locationId for NPCs who were TOLD (see
 * EventWitness) that their current location is doomed. They flee even when
 * the location's actual score isn't distressed — rumors move people, not
 * just measurements. Only named NPCs act on hearsay; the background
 * population drifts on visible decline alone. Empty by default, which
 * preserves the pre-hearsay behavior exactly.
 *
 * `rivalByFactionId` maps factionId -> its RIVAL factionId (see
 * findRivalId). Destinations owned by the fleeing party's faction's
 * rival take a −10 score penalty (see destinationScore) — a preference,
 * not a veto (see pickDestination). Empty by default, which preserves
 * the pre-rival behavior exactly.
 */
export function decideMigration(
  distressedLocations: DistressedLocationInput[],
  candidateDestinations: DestinationLocationInput[],
  npcs: MigratingNpcInput[],
  edges: AdjacencyEdge[] = [],
  hearsayDoom: Map<string, string> = new Map(),
  rivalByFactionId: Map<string, string> = new Map()
): { npcMoves: MigrationDecision[]; populationShifts: PopulationShiftDecision[]; populationFlights: PopulationFlightDecision[] } {
  const npcMoves: MigrationDecision[] = []
  const populationFlights: PopulationFlightDecision[] = []

  if (candidateDestinations.length === 0) {
    return { npcMoves, populationShifts: [], populationFlights: [] }
  }

  // Destination ranking is rival-AWARE, not exclusion-based: the sort
  // lives inside pickDestination (see destinationScore), scored
  // separately per fleeing party's rival — a destination owned by the
  // faction's rival takes a −10 penalty but can still win when it's
  // genuinely the best option. Weather stays a tie-break below the
  // score, and id is the final tie-break so the result never depends on
  // query row order. The sort is memoized per rivalId because the loop
  // below picks for many locations and many NPCs.
  const sortedByRival = new Map<string | null, DestinationLocationInput[]>()

  const nameById = new Map<string, string>()
  const workingPopulation = new Map<string, number>()
  for (const loc of [...distressedLocations, ...candidateDestinations]) {
    nameById.set(loc.id, loc.name)
    if (loc.population !== null) workingPopulation.set(loc.id, loc.population)
  }

  for (const location of distressedLocations) {
    if (location.conditionScore >= DISTRESS_THRESHOLD) continue
    // Refugees don't flee into their faction's rival's arms: the
    // source-level rival penalty uses the source location's owner. Each
    // named NPC below re-checks against their OWN faction's rival when
    // it differs from the source owner's — a guest's faction is theirs,
    // not the town's.
    const sourceRival = location.ownerFactionId ? rivalByFactionId.get(location.ownerFactionId) : undefined
    const sourceDestination = pickDestination(location.id, candidateDestinations, edges, sortedByRival, sourceRival)
    if (!sourceDestination) continue
    const destinationForNpc = (npc: MigratingNpcInput): DestinationLocationInput | null => {
      const npcRival = npc.factionId ? rivalByFactionId.get(npc.factionId) : undefined
      if (npcRival && npcRival !== sourceRival) {
        return pickDestination(location.id, candidateDestinations, edges, sortedByRival, npcRival)
      }
      return sourceDestination
    }

    // NPC motivation model: the most self-preserving residents flee first
    // (taking the limited per-tick slots), and anyone below
    // FLIGHT_STAY_THRESHOLD refuses to flee at all regardless of slots —
    // deterministic tiebreak by id so the outcome never depends on query
    // row order.
    const residents = npcs
      .filter((npc) => npc.isAlive && npc.locationId === location.id && selfPreservationOf(npc) >= FLIGHT_STAY_THRESHOLD)
      .sort((a, b) => selfPreservationOf(b) - selfPreservationOf(a) || a.id.localeCompare(b.id))
    for (const npc of residents.slice(0, MAX_NPC_MIGRATIONS_PER_LOCATION)) {
      const destination = destinationForNpc(npc)
      if (!destination) continue
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
      const destPopulation = workingPopulation.get(sourceDestination.id)
      if (destPopulation !== undefined) {
        workingPopulation.set(sourceDestination.id, destPopulation + fleeing)
      }
      populationFlights.push({
        fromLocationId: location.id,
        fromLocationName: location.name,
        toLocationId: sourceDestination.id,
        toLocationName: sourceDestination.name,
        count: fleeing,
      })
    }
  }

  const initialById = new Map<string, number>()
  for (const loc of [...distressedLocations, ...candidateDestinations]) {
    if (loc.population !== null) initialById.set(loc.id, loc.population)
  }

  // Hearsay flight: an NPC who was told their home is doomed flees on the
  // rumor even when the score says the place is fine. Same gates as
  // score-driven flight (alive, self-preserving enough, a viable
  // destination exists) and never double-moves an NPC who already fled a
  // genuinely distressed location this tick.
  const distressedIds = new Set(distressedLocations.map((l) => l.id))
  const movedNpcIds = new Set(npcMoves.map((m) => m.npcId))
  for (const [npcId, doomedLocationId] of hearsayDoom) {
    const npc = npcs.find((n) => n.id === npcId)
    if (!npc || !npc.isAlive) continue
    if (npc.locationId !== doomedLocationId) continue
    if (distressedIds.has(doomedLocationId)) continue
    if (movedNpcIds.has(npcId)) continue
    if (selfPreservationOf(npc) < FLIGHT_STAY_THRESHOLD) continue
    // Hearsay flight is personal — the rumor belongs to the NPC, so the
    // rival penalty uses THEIR faction, not a source location owner's.
    const npcRival = npc.factionId ? rivalByFactionId.get(npc.factionId) : undefined
    const destination = pickDestination(doomedLocationId, candidateDestinations, edges, sortedByRival, npcRival)
    if (!destination) continue
    npcMoves.push({
      npcId: npc.id,
      npcName: npc.name,
      fromLocationId: doomedLocationId,
      fromLocationName: nameById.get(doomedLocationId) ?? doomedLocationId,
      toLocationId: destination.id,
      toLocationName: destination.name,
    })
    movedNpcIds.add(npcId)
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

  return { npcMoves, populationShifts, populationFlights }
}

export async function tickMigration(ctx: TickContext): Promise<TickHandlerResult> {
  const locations = await ctx.db.location.findMany({
    where: { campaignId: ctx.campaignId, isDiscovered: true },
    select: { id: true, name: true, conditionScore: true, population: true, weather: true, weatherSeverity: true, ownerFactionId: true },
  })

  // Owner health (for destination desirability) and rival ties (so
  // refugees don't flee to their faction's rival) — one batched read,
  // using the same TIE_INCLUDE + findRivalId pairing factionTick.ts uses.
  const factions = await ctx.db.faction.findMany({
    where: { campaignId: ctx.campaignId },
    include: TIE_INCLUDE,
  })
  const ownerHealthByFactionId = new Map(factions.map((f) => [f.id, { resources: f.resources, stability: f.stability }]))
  const rivalByFactionId = new Map<string, string>()
  for (const faction of factions) {
    const rivalId = findRivalId(factionTies(faction))
    if (rivalId) rivalByFactionId.set(faction.id, rivalId)
  }

  // Rumors re-enter the sim: NPCs who were TOLD (EventWitness, grade TOLD)
  // that their location is doomed flee on the rumor even when the score
  // says the place is fine. Two rumor kinds:
  //
  // - location_condition.conditionScore rows: doom means the event's new
  //   condition score sits below DISTRESS_THRESHOLD. The NPC acts on what
  //   they believe they heard, not the ground truth — an EXAGGERATED
  //   retelling shifts the perceived score −20 (worse than truth), a
  //   MINIMIZED one +20 (better); other distortion flavors don't move it
  //   (see perceivedConditionScore).
  // - location_population.populationFlight rows: a large flight is itself
  //   the doom signal — the flight IS the news, so the source location
  //   (entityId on those rows) reads as doomed with no score to parse.
  //   Reuses HEARSAY_DOOM_TURNS: a told flight stays actionable as long
  //   as a told condition-doom does.
  //
  // Dead NPCs are excluded by the isAlive filter on the NPC read below,
  // even when a stale TOLD row names them.
  const doomHearsay = await ctx.db.eventWitness.findMany({
    where: {
      campaignId: ctx.campaignId,
      grade: 'TOLD',
      npcId: { not: null },
      turnNumber: { gte: ctx.turnNumber - HEARSAY_DOOM_TURNS },
      worldEvent: { type: { in: ['location_condition.conditionScore', 'location_population.populationFlight'] } },
    },
    select: {
      npcId: true,
      distorted: true,
      distortionFlavor: true,
      worldEvent: { select: { targetId: true, newValue: true, type: true } },
    },
  })
  const hearsayDoom = new Map<string, string>()
  for (const row of doomHearsay) {
    if (!row.npcId) continue
    // A large flight is itself the doom signal: the source location
    // reads as doomed, no score to parse — the flight IS the news.
    if (row.worldEvent.type === 'location_population.populationFlight') {
      hearsayDoom.set(row.npcId, row.worldEvent.targetId)
      continue
    }
    const doomScore = parseInt(row.worldEvent.newValue ?? '', 10)
    if (Number.isNaN(doomScore)) continue
    // Test the doom threshold against the PERCEIVED score — distorted
    // rumors move the NPC even when the true value wouldn't (or wouldn't
    // have, when the rumor minimized a real doom).
    const perceivedScore = perceivedConditionScore(doomScore, row.distorted, row.distortionFlavor)
    if (perceivedScore >= DISTRESS_THRESHOLD) continue
    hearsayDoom.set(row.npcId, row.worldEvent.targetId)
  }

  const distressedLocations: DistressedLocationInput[] = locations
    .filter((l) => l.conditionScore < DISTRESS_THRESHOLD)
    .map((l) => ({ id: l.id, name: l.name, conditionScore: l.conditionScore, population: l.population, ownerFactionId: l.ownerFactionId }))
  const heardLocationIds = new Set(hearsayDoom.values())
  // NPCs worth reading: residents of distressed locations, plus anyone
  // camped at a location they've heard is doomed (they may flee on the
  // rumor even with no distressed location in the campaign at all).
  const npcLocationIds = new Set([
    ...distressedLocations.map((l) => l.id),
    ...heardLocationIds,
  ])
  if (npcLocationIds.size === 0) return { changes: [] }

  const candidateDestinations: DestinationLocationInput[] = locations
    .filter((l) => l.conditionScore >= VIABLE_THRESHOLD)
    .map((l) => {
      const health = l.ownerFactionId ? ownerHealthByFactionId.get(l.ownerFactionId) : undefined
      return {
        id: l.id,
        name: l.name,
        conditionScore: l.conditionScore,
        population: l.population,
        weather: l.weather ?? undefined,
        weatherSeverity: l.weatherSeverity ?? undefined,
        ownerFactionId: l.ownerFactionId,
        ownerFactionResources: health?.resources ?? null,
        ownerFactionStability: health?.stability ?? null,
      }
    })
  if (candidateDestinations.length === 0) return { changes: [] }

  const [npcs, adjacencyRows] = await Promise.all([
    ctx.db.nPC.findMany({
      where: {
        campaignId: ctx.campaignId,
        isAlive: true,
        locationId: { in: Array.from(npcLocationIds) },
      },
      select: { id: true, name: true, locationId: true, isAlive: true, importance: true, disposition: true, factionId: true },
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

  const { npcMoves, populationShifts, populationFlights } = decideMigration(
    distressedLocations,
    candidateDestinations,
    npcs.map((n) => ({
      id: n.id,
      name: n.name,
      locationId: n.locationId,
      isAlive: n.isAlive,
      selfPreservation: parseDisposition(n.disposition)?.selfPreservation,
      factionId: n.factionId,
    })),
    adjacencyRows as AdjacencyEdge[],
    hearsayDoom,
    rivalByFactionId
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
    // A move from a location the NPC heard was doomed (but whose score is
    // fine) is rumor-driven, not score-driven — say so, so the history
    // reads honestly about WHY they ran.
    const rumorDriven = hearsayDoom.get(move.npcId) === move.fromLocationId
    changes.push({
      entityType: 'NPC',
      entityId: move.npcId,
      entityName: move.npcName,
      campaignId: ctx.campaignId,
      field: 'currentLocation',
      previousValue: move.fromLocationName,
      newValue: move.toLocationName,
      reason: rumorDriven
        ? `${move.npcName} fled ${move.fromLocationName} for ${move.toLocationName} on rumors of its coming ruin`
        : `${move.npcName} fled the deteriorating conditions in ${move.fromLocationName} for ${move.toLocationName}`,
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

  // A large exodus IS newsworthy — a significant change the information
  // bus picks up as a rumor next turn, so PopulationFlightEvent stops
  // being write-only. Small flows stay routine drift (see above).
  for (const flight of populationFlights) {
    if (flight.count < FLIGHT_RUMOR_THRESHOLD) continue
    changes.push({
      entityType: 'LOCATION_POPULATION',
      entityId: flight.fromLocationId,
      entityName: flight.fromLocationName,
      campaignId: ctx.campaignId,
      field: 'populationFlight',
      previousValue: flight.fromLocationName,
      newValue: flight.toLocationName,
      reason: `${flight.count} residents fled ${flight.fromLocationName} for ${flight.toLocationName} as conditions collapsed`,
      significant: true,
      importance: 'NORMAL',
    })
  }

  // #262: a bounded, per-tick record of where a location's population
  // actually came from — the LOCATION_POPULATION changes above only carry
  // a net previous/new total per location, not the source.
  if (!ctx.dryRun && populationFlights.length > 0) {
    await ctx.db.populationFlightEvent.createMany({
      data: populationFlights.map((flight) => ({
        campaignId: ctx.campaignId,
        turnNumber: ctx.turnNumber,
        fromLocationId: flight.fromLocationId,
        fromLocationName: flight.fromLocationName,
        toLocationId: flight.toLocationId,
        toLocationName: flight.toLocationName,
        count: flight.count,
      })),
    })
  }

  return { changes }
}
