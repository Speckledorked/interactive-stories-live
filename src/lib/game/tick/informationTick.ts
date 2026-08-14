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

import { TickContext, TickHandlerResult } from './types'
import { AdjacencyEdge, graphDiameter, shortestPath } from '../worldGraph'
import type { WorldEventTargetType } from '@prisma/client'

const BASE_PROPAGATION_DELAY_TURNS = 1
const TURNS_PER_DISTANCE_UNIT = 1
// No graph coverage for this event/character pair (either location is
// unknown, or the graph doesn't connect them) — a flat delay, not a
// block. Bigger than BASE_PROPAGATION_DELAY_TURNS so word-of-mouth with
// no known distance is never FASTER than a next-door neighbor hearing it.
const FLAT_FALLBACK_DELAY_TURNS = 3

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
const FALLBACK_MAX_WINDOW_TURNS = 60

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

export interface InformationSpreadDecision {
  worldEventId: string
  characterId: string
}

function propagationDelay(
  originLocationId: string | null,
  characterLocationId: string | null,
  edges: AdjacencyEdge[]
): number {
  if (!originLocationId || !characterLocationId) return FLAT_FALLBACK_DELAY_TURNS
  const result = shortestPath(edges, originLocationId, characterLocationId)
  if (!result) return FLAT_FALLBACK_DELAY_TURNS
  return BASE_PROPAGATION_DELAY_TURNS + result.distance * TURNS_PER_DISTANCE_UNIT
}

/**
 * Pure — no DB access, safe to unit test directly. `coveredPairs` is every
 * `${worldEventId}:${characterId}` pair that already has ANY EventWitness
 * row (WITNESSED or TOLD) — never re-decided. This is also why a TOLD
 * decision can never downgrade an existing WITNESSED row: the caller's
 * own `skipDuplicates: true` insert is a second, redundant layer of the
 * same guarantee, but this filter is what keeps the decision from even
 * being computed in the first place.
 */
export function decideInformationSpread(input: {
  currentTurn: number
  events: InformationSpreadEventInput[]
  characters: InformationSpreadCharacterInput[]
  coveredPairs: Set<string>
  edges: AdjacencyEdge[]
}): InformationSpreadDecision[] {
  const { currentTurn, events, characters, coveredPairs, edges } = input
  const decisions: InformationSpreadDecision[] = []

  for (const event of events) {
    const age = currentTurn - event.turnNumber
    for (const character of characters) {
      const pairKey = `${event.worldEventId}:${character.characterId}`
      if (coveredPairs.has(pairKey)) continue
      const delay = propagationDelay(event.originLocationId, character.locationId, edges)
      if (age >= delay) {
        decisions.push({ worldEventId: event.worldEventId, characterId: character.characterId })
      }
    }
  }

  return decisions
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

  const characters = await ctx.db.character.findMany({
    where: { campaignId: ctx.campaignId, isAlive: true },
    select: { id: true, locationId: true },
  })
  if (characters.length === 0) return { changes: [] }

  const existingWitnesses = await ctx.db.eventWitness.findMany({
    where: { worldEventId: { in: events.map((e) => e.id) } },
    select: { worldEventId: true, characterId: true },
  })
  const coveredPairs = new Set(existingWitnesses.map((w) => `${w.worldEventId}:${w.characterId}`))

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
    coveredPairs,
    edges,
  })

  if (!ctx.dryRun && decisions.length > 0) {
    await ctx.db.eventWitness.createMany({
      data: decisions.map((d) => ({
        campaignId: ctx.campaignId,
        worldEventId: d.worldEventId,
        characterId: d.characterId,
        grade: 'TOLD' as const,
        turnNumber: ctx.turnNumber,
      })),
      skipDuplicates: true,
    })
  }

  return { changes: [] }
}
