// src/lib/game/tick/informationTick.ts
// Information Latency / Canon-per-Viewer (#101), PR 2/3 — the TOLD half.
// PR 1/3 wired WITNESSED (a scene's participants learn about significant
// WorldEvents from that scene the instant they happen). This handler is
// the other path: a character who WASN'T there can still hear about a
// significant event later, with a delay driven by real graph distance
// (worldGraph.ts's shortestPath) from where it happened to where they
// are now — adjacency-AWARE, not adjacency-DEPENDENT, same convention as
// every other worldGraph.ts consumer: no graph coverage falls back to a
// flat delay, never blocks propagation entirely.
//
// #373: NPCs now have a SECOND channel. Word reaches an NPC by whichever
// route is faster — the map, or the people they know (tieGraph.ts's
// socialDistancesFrom over ALLY edges, seeded from whoever was standing
// where it happened). Until #373 this file borrowed graphDiameter from
// WorldGraph and propagated by physical distance alone, using geography as
// a stand-in for social distance because social distance was not
// computable over per-node JSON blobs. It is now, and it is a minimum
// rather than a replacement: a campaign with no ties on record behaves
// exactly as it did before.
//
// Deliberately does NOT reach back before a bounded window — an event
// whose computed delay would land outside that window never reaches that
// character in v1, silently. This is accepted v1 scope, not a bug: the
// alternative (an unbounded candidate-event query, re-scanned every tick,
// forever) doesn't pay for itself. #101 v1.1: the window itself
// (computePropagationWindow, below) is now derived from the campaign's
// real graph diameter instead of a fixed magic constant — a fixed window
// can silently strand a character on the far side of a large map forever,
// no matter how long they wait.
//
// Writes a silent side-table, like PopulationFlightEvent (#262) — a
// character finding out about something isn't itself new campaign
// history; the underlying event already became that when it was
// created. Returns { changes: [] } for the same reason.

// roster-exempt: information spreads to WITNESSES, not to a simulated
// subset. An NPC outside this tick's roster still hears what happened next
// door — restricting propagation to the roster would make what a character
// knows depend on which entities the cap happened to select. Note this
// handler's cost is genuinely unbounded as a result; see #407.

import { TickContext, TickHandlerResult, stableHash } from './types'
import { AdjacencyEdge, graphDiameter, distancesFrom } from '../worldGraph'
import { TieEdge, edgesFromNpcRows, socialDistancesFrom } from '../tieGraph'
import type { WorldEventTargetType, EventWitnessDistortion } from '@prisma/client'

const BASE_PROPAGATION_DELAY_TURNS = 1
const TURNS_PER_DISTANCE_UNIT = 1
// No graph coverage for this event/character pair (either location is
// unknown, or the graph doesn't connect them) — a flat delay, not a
// block. Bigger than BASE_PROPAGATION_DELAY_TURNS so word-of-mouth with
// no known distance is never FASTER than a next-door neighbor hearing it.
const FLAT_FALLBACK_DELAY_TURNS = 3
// #373: one turn per SOCIAL hop, the same rate as one turn per map hop.
// Deliberately not faster: an NPC hearing it from a friend who heard it
// from a friend is one retelling per link either way, and making the
// social channel cheaper than the physical one would be asserting
// something about how gossip travels that nothing in the fiction supports.
// What the social channel buys is REACH, not speed — an ally three
// countries away is one hop, and used to be unreachable inside the window.
const TURNS_PER_SOCIAL_HOP = 1

// A floor under the graph-derived window so a tiny/disconnected map (small
// or zero diameter) still gives an event a reasonable minimum chance to
// propagate, plus a safety margin over the raw diameter-derived delay so a
// character exactly at the graph's edge isn't cut off by the window that's
// supposedly sized for them.
export const MIN_PROPAGATION_WINDOW_TURNS = 10
const WINDOW_SAFETY_MARGIN_TURNS = 5
// tickInformation runs inside worldTick.ts's single shared 20s
// prisma.$transaction alongside every other handler — a diameter
// computation blowup here (graphDiameter is O(V^2 log V)) would time out
// the WHOLE tick, not just this handler. Real campaigns run tens of
// locations (see worldGraph.ts's own doc comment); this cap is defensive
// margin. Above it, fall back to a generous fixed window rather than
// paying the O(V^2) cost.
const MAX_LOCATIONS_FOR_DIAMETER = 50
export const FALLBACK_MAX_WINDOW_TURNS = 60

/**
 * Pure — how many turns back tickInformation should look for candidate
 * events, derived from the campaign's actual map instead of a fixed magic
 * constant. Mirrors propagationDelay's own worst-case (BASE_PROPAGATION_
 * DELAY_TURNS + graph diameter), floored and margined so nothing realistic
 * silently ages out before it can ever reach the farthest character.
 */
export function computePropagationWindow(edges: AdjacencyEdge[]): number {
  const locationCount = new Set(edges.flatMap((e) => [e.locationAId, e.locationBId])).size
  if (locationCount > MAX_LOCATIONS_FOR_DIAMETER) return FALLBACK_MAX_WINDOW_TURNS
  const diameter = graphDiameter(edges)
  return (
    Math.max(MIN_PROPAGATION_WINDOW_TURNS, FLAT_FALLBACK_DELAY_TURNS, BASE_PROPAGATION_DELAY_TURNS + diameter * TURNS_PER_DISTANCE_UNIT) +
    WINDOW_SAFETY_MARGIN_TURNS
  )
}

export interface InformationSpreadEventInput {
  worldEventId: string
  turnNumber: number
  originLocationId: string | null
}

export interface InformationSpreadCharacterInput {
  characterId: string
  locationId: string | null
}

// NPCs never get WITNESSED (see EventWitness's schema comment) — only ever
// fed into this handler's TOLD path, otherwise identical to a Character
// input.
export interface InformationSpreadNpcInput {
  npcId: string
  locationId: string | null
}

// A decision carries exactly one of characterId/npcId, mirroring
// EventWitness's own "exactly one of" shape.
export interface InformationSpreadDecision {
  worldEventId: string
  characterId?: string
  npcId?: string
}

/**
 * #407: one traversal per DISTINCT origin, memoized for the caller's
 * lifetime.
 *
 * Several events in a turn routinely share a location — a war's contested
 * site, a busy settlement — so this saves on top of the per-pair saving.
 * Both the decision pass and the write pass go through the same resolver,
 * because they ask the same question about the same events.
 */
export function createDistanceResolver(
  edges: AdjacencyEdge[]
): (originLocationId: string | null) => Map<string, number> | null {
  const byOrigin = new Map<string, Map<string, number>>()
  return (originLocationId) => {
    if (!originLocationId) return null
    let cached = byOrigin.get(originLocationId)
    if (!cached) {
      cached = distancesFrom(edges, originLocationId)
      byOrigin.set(originLocationId, cached)
    }
    return cached
  }
}

/**
 * #407: distances from one origin, computed once and reused.
 *
 * This used to be a per-(event, witness) shortestPath call — a full
 * Dijkstra AND a rebuild of the neighbour map from the edge list, inside a
 * nested loop over events x (characters + NPCs) with neither dimension
 * bounded by npcCap. Under a frozen turn counter the event window never
 * shrank either, which made this the handler most likely to exhaust the
 * shared 20s tick transaction and take the entire world turn down.
 *
 * One single-source traversal per DISTINCT origin location answers every
 * witness for every event at that origin.
 */
function propagationDelayFrom(
  distances: Map<string, number> | null,
  witnessLocationId: string | null
): number {
  if (!distances || !witnessLocationId) return FLAT_FALLBACK_DELAY_TURNS
  const distance = distances.get(witnessLocationId)
  if (distance === undefined) return FLAT_FALLBACK_DELAY_TURNS
  return BASE_PROPAGATION_DELAY_TURNS + distance * TURNS_PER_DISTANCE_UNIT
}

/**
 * #373: social hops from whoever was AT the event to everyone else, one
 * traversal per distinct origin, memoized exactly like the physical one.
 *
 * The seeds are the NPCs standing where it happened — they are the people
 * who could tell anyone. From there word moves along ALLY edges only: a
 * rival is on record as someone this NPC is in conflict with, and treating
 * a rivalry as a channel would say the one person you refuse to speak to
 * is how you find things out.
 *
 * This is the capability #373 was filed for. Before it, informationTick
 * borrowed `graphDiameter` from WorldGraph and propagated by PHYSICAL
 * distance alone — rumours spread by geography, not by who talks to whom —
 * because social distance was not computable over per-node JSON blobs.
 */
export function createSocialDistanceResolver(
  npcTies: TieEdge[],
  npcs: InformationSpreadNpcInput[]
): (originLocationId: string | null) => Map<string, number> | null {
  if (npcTies.length === 0) return () => null

  const npcsByLocation = new Map<string, string[]>()
  for (const npc of npcs) {
    if (!npc.locationId) continue
    const list = npcsByLocation.get(npc.locationId)
    if (list) list.push(npc.npcId)
    else npcsByLocation.set(npc.locationId, [npc.npcId])
  }

  const byOrigin = new Map<string, Map<string, number>>()
  return (originLocationId) => {
    if (!originLocationId) return null
    let cached = byOrigin.get(originLocationId)
    if (!cached) {
      const seeds = npcsByLocation.get(originLocationId) ?? []
      // Nobody was there to carry it: no social channel for this event.
      // Distinct from "nobody has ties", which the early return above
      // already handled.
      if (seeds.length === 0) return null
      cached = socialDistancesFrom(npcTies, seeds, { through: ['ALLY'] })
      byOrigin.set(originLocationId, cached)
    }
    return cached
  }
}

/**
 * #373: an NPC hears it by whichever route reaches them first — the map or
 * the people.
 *
 * A minimum, not a replacement. The social channel can only ever make word
 * arrive SOONER, so a campaign with no ties on record behaves exactly as it
 * did before, and the propagation window (sized from the physical
 * diameter) still bounds every delay this can produce.
 */
export function npcPropagationDelay(
  physicalDistances: Map<string, number> | null,
  socialDistances: Map<string, number> | null,
  npc: InformationSpreadNpcInput
): number {
  const physical = propagationDelayFrom(physicalDistances, npc.locationId)
  const hops = socialDistances?.get(npc.npcId)
  if (hops === undefined) return physical
  return Math.min(physical, BASE_PROPAGATION_DELAY_TURNS + hops * TURNS_PER_SOCIAL_HOP)
}

/**
 * Pure — no DB access, safe to unit test directly. `coveredPairs` is every
 * `${worldEventId}:${characterId}` (or `${worldEventId}:npc:${npcId}` for
 * an NPC) pair that already has ANY EventWitness row (WITNESSED or TOLD)
 * — never re-decided. This is also why a TOLD decision can never downgrade
 * an existing WITNESSED row: the caller's own `skipDuplicates: true`
 * insert is a second, redundant layer of the same guarantee, but this
 * filter is what keeps the decision from even being computed in the first
 * place. The `npc:` prefix on NPC keys is load-bearing, not decorative —
 * without it, a Character cuid and an NPC cuid could theoretically collide
 * as bare strings and silently cross-cover each other's coverage.
 */
export function decideInformationSpread(input: {
  currentTurn: number
  events: InformationSpreadEventInput[]
  characters: InformationSpreadCharacterInput[]
  npcs?: InformationSpreadNpcInput[]
  coveredPairs: Set<string>
  edges: AdjacencyEdge[]
  /** #373: NPC social ties. Absent behaves exactly like an empty graph —
   * the physical channel alone, i.e. the pre-#373 behaviour. */
  npcTies?: TieEdge[]
}): InformationSpreadDecision[] {
  const { currentTurn, events, characters, npcs = [], coveredPairs, edges, npcTies = [] } = input
  const decisions: InformationSpreadDecision[] = []

  const distancesFor = createDistanceResolver(edges)
  const socialDistancesFor = createSocialDistanceResolver(npcTies, npcs)

  for (const event of events) {
    const age = currentTurn - event.turnNumber
    const distances = distancesFor(event.originLocationId)
    const socialDistances = socialDistancesFor(event.originLocationId)
    for (const character of characters) {
      const pairKey = `${event.worldEventId}:${character.characterId}`
      if (coveredPairs.has(pairKey)) continue
      const delay = propagationDelayFrom(distances, character.locationId)
      if (age >= delay) {
        decisions.push({ worldEventId: event.worldEventId, characterId: character.characterId })
      }
    }
    for (const npc of npcs) {
      const pairKey = `${event.worldEventId}:npc:${npc.npcId}`
      if (coveredPairs.has(pairKey)) continue
      const delay = npcPropagationDelay(distances, socialDistances, npc)
      if (age >= delay) {
        decisions.push({ worldEventId: event.worldEventId, npcId: npc.npcId })
      }
    }
  }

  return decisions
}

// Misinformation: only ever rolled for a TOLD decision (WITNESSED is
// ground truth, never distorted — the caller must never invoke this for a
// WITNESSED write). Longer propagation delay implies more retellings
// happened along the way, so it's used as a cheap proxy for "how many
// hops" without literally simulating chained retellings turn by turn —
// real scope creep for a v1, and the delay this handler already computes
// from real graph distance IS the natural "how many hops" signal, not a
// second one invented just for this.
const DISTORTION_FLAVORS: EventWitnessDistortion[] = ['EXAGGERATED', 'MINIMIZED', 'GARBLED_DETAIL', 'ATTRIBUTED_WRONG']
const SHORT_DELAY_THRESHOLD_TURNS = 3
const SHORT_DELAY_DISTORTION_PCT = 15
const LONG_DELAY_DISTORTION_PCT = 45

/**
 * Pure — deterministic stableHash "roll" (this codebase's established
 * convention for every tick decision, e.g. decideArcDelta/decideWarResolution
 * — never Math.random()). `witnessKey` must be the SAME discriminated key
 * decideInformationSpread produces (`characterId` or `npc:${npcId}`) so a
 * Character and an NPC witnessing the same event never accidentally share
 * a roll. Tuned starting thresholds (15%/45%), not derived from anything
 * else in the codebase — adjust to taste via the two constants above.
 */
export function decideDistortion(
  worldEventId: string,
  witnessKey: string,
  turnNumber: number,
  delay: number
): { distorted: boolean; flavor: EventWitnessDistortion | null } {
  const threshold = delay <= SHORT_DELAY_THRESHOLD_TURNS ? SHORT_DELAY_DISTORTION_PCT : LONG_DELAY_DISTORTION_PCT
  const roll = stableHash(`${worldEventId}:${witnessKey}:${turnNumber}:distortion`) % 100
  if (roll >= threshold) return { distorted: false, flavor: null }
  const flavorIdx = stableHash(`${worldEventId}:${witnessKey}:${turnNumber}:flavor`) % DISTORTION_FLAVORS.length
  return { distorted: true, flavor: DISTORTION_FLAVORS[flavorIdx] }
}

// Resolves where a WorldEvent "happened" for propagation purposes.
// LOCATION*-targeted events use the target location directly — always
// available and 100% accurate, since the target IS the location. Every
// other event type reads WorldEvent.originLocationId (#101 v1.1),
// captured by the writer at the moment the change happened (see
// npcTick.ts/consequences.ts/warTick.ts) rather than approximated later
// from the target entity's CURRENT location, which drifts once the
// entity moves. Older, pre-migration rows and event types with no single
// natural location (FACTION-non-war/QUEST/CHARACTER/DEBT) simply have
// none — a valid, silent "no location signal", so every character gets
// the flat fallback delay for those — campaign-wide gossip with no
// geography.
const LOCATION_TARGET_TYPES: WorldEventTargetType[] = ['LOCATION', 'LOCATION_WEATHER', 'LOCATION_CONDITION', 'LOCATION_POPULATION']

export async function tickInformation(ctx: TickContext): Promise<TickHandlerResult> {
  // Edges fetched first: the events query's lookback window now depends on
  // the graph's diameter, computed from these.
  const edges = (await ctx.db.locationAdjacency.findMany({
    where: { campaignId: ctx.campaignId },
    select: { locationAId: true, locationBId: true, distance: true },
  })) as AdjacencyEdge[]
  const propagationWindow = computePropagationWindow(edges)

  const events = await ctx.db.worldEvent.findMany({
    where: {
      campaignId: ctx.campaignId,
      significant: true,
      turnNumber: { gte: ctx.turnNumber - propagationWindow },
    },
    select: { id: true, turnNumber: true, targetType: true, targetId: true, originLocationId: true },
  })
  if (events.length === 0) return { changes: [] }

  const [characters, npcs, npcTieRows] = await Promise.all([
    ctx.db.character.findMany({
      where: { campaignId: ctx.campaignId, isAlive: true },
      select: { id: true, locationId: true },
    }),
    ctx.db.nPC.findMany({
      where: { campaignId: ctx.campaignId, isAlive: true },
      select: { id: true, locationId: true },
    }),
    // #373: the social channel. roster-exempt for the same reason the NPC
    // query above is — who hears what must not depend on which entities
    // this turn's cap happened to select.
    ctx.db.npcTie.findMany({
      where: { campaignId: ctx.campaignId },
      select: { npcAId: true, npcBId: true, type: true, since: true },
    }),
  ])
  const npcTies = edgesFromNpcRows(npcTieRows)
  // Bug fixed alongside the NPC addition: this used to early-return on
  // characters.length === 0 alone, which would have silently skipped NPC
  // propagation too in a tick with zero living Characters.
  if (characters.length === 0 && npcs.length === 0) return { changes: [] }

  const existingWitnesses = await ctx.db.eventWitness.findMany({
    where: { worldEventId: { in: events.map((e) => e.id) } },
    select: { worldEventId: true, characterId: true, npcId: true },
  })
  const coveredPairs = new Set(
    existingWitnesses.map((w) => (w.npcId ? `${w.worldEventId}:npc:${w.npcId}` : `${w.worldEventId}:${w.characterId}`))
  )

  const eventInputs: InformationSpreadEventInput[] = events.map((event) => {
    const originLocationId = LOCATION_TARGET_TYPES.includes(event.targetType)
      ? event.targetId
      : event.originLocationId ?? null
    return { worldEventId: event.id, turnNumber: event.turnNumber, originLocationId }
  })

  const decisions = decideInformationSpread({
    currentTurn: ctx.turnNumber,
    events: eventInputs,
    characters: characters.map((c) => ({ characterId: c.id, locationId: c.locationId })),
    npcs: npcs.map((n) => ({ npcId: n.id, locationId: n.locationId })),
    coveredPairs,
    edges,
    npcTies,
  })

  if (!ctx.dryRun && decisions.length > 0) {
    const eventById = new Map(eventInputs.map((e) => [e.worldEventId, e]))
    const locationById = new Map<string, string | null>([
      ...characters.map((c) => [c.id, c.locationId] as const),
      ...npcs.map((n) => [n.id, n.locationId] as const),
    ])
    const npcInputs = npcs.map((n) => ({ npcId: n.id, locationId: n.locationId }))
    const socialDistancesForWrite = createSocialDistanceResolver(npcTies, npcInputs)
    // #407: same memoized resolver as the decision pass above — the write
    // pass asks the same question about the same events, and used to
    // answer it with a fresh full Dijkstra per row.
    const distancesForWrite = createDistanceResolver(edges)
    await ctx.db.eventWitness.createMany({
      data: decisions.map((d) => {
        const witnessId = d.npcId ?? d.characterId!
        const witnessKey = d.npcId ? `npc:${d.npcId}` : d.characterId!
        const event = eventById.get(d.worldEventId)!
        // The write pass must compute the SAME delay the decision pass
        // did — decideDistortion is a function of it, so a mismatch would
        // make how garbled a rumour is disagree with how far it travelled.
        const witnessLocationId = locationById.get(witnessId) ?? null
        const delay = d.npcId
          ? npcPropagationDelay(
              distancesForWrite(event.originLocationId),
              socialDistancesForWrite(event.originLocationId),
              { npcId: d.npcId, locationId: witnessLocationId }
            )
          : propagationDelayFrom(distancesForWrite(event.originLocationId), witnessLocationId)
        const { distorted, flavor } = decideDistortion(d.worldEventId, witnessKey, ctx.turnNumber, delay)
        return {
          campaignId: ctx.campaignId,
          worldEventId: d.worldEventId,
          ...(d.npcId ? { npcId: d.npcId } : { characterId: d.characterId }),
          grade: 'TOLD' as const,
          turnNumber: ctx.turnNumber,
          distorted,
          distortionFlavor: flavor,
        }
      }),
      skipDuplicates: true,
    })
  }

  return { changes: [] }
}
