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
// Deliberately does NOT reach back before a bounded window
// (PROPAGATION_WINDOW_TURNS) — an event whose computed delay would land
// outside that window never reaches that character in v1, silently. This
// is accepted v1 scope, not a bug: the alternative (an unbounded
// candidate-event query, re-scanned every tick, forever) doesn't pay for
// itself against "this codebase's real campaigns have small enough maps
// that nothing realistic needs more than a few dozen turns to cross it."
//
// Writes a silent side-table, like PopulationFlightEvent (#262) — a
// character finding out about something isn't itself new campaign
// history; the underlying event already became that when it was
// created. Returns { changes: [] } for the same reason.

import { TickContext, TickHandlerResult } from './types'
import { AdjacencyEdge, shortestPath } from '../worldGraph'
import type { WorldEventTargetType } from '@prisma/client'

export const PROPAGATION_WINDOW_TURNS = 30
const BASE_PROPAGATION_DELAY_TURNS = 1
const TURNS_PER_DISTANCE_UNIT = 1
// No graph coverage for this event/character pair (either location is
// unknown, or the graph doesn't connect them) — a flat delay, not a
// block. Bigger than BASE_PROPAGATION_DELAY_TURNS so word-of-mouth with
// no known distance is never FASTER than a next-door neighbor hearing it.
const FLAT_FALLBACK_DELAY_TURNS = 3

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

// Resolves where a WorldEvent "happened" for propagation purposes, from
// its targetType/targetId — approximated from the target's CURRENT
// location, not a location captured at the moment the event happened
// (WorldEvent has no field for that; out of scope for v1). NPC-targeted
// events use the NPC's current location; LOCATION* events use the target
// location directly; WAR events use the war's contested location;
// everything else (FACTION/QUEST/CHARACTER/DEBT) has no location signal
// at all, so every character gets the flat fallback delay for it —
// campaign-wide gossip with no geography.
const LOCATION_TARGET_TYPES: WorldEventTargetType[] = ['LOCATION', 'LOCATION_WEATHER', 'LOCATION_CONDITION', 'LOCATION_POPULATION']

export async function tickInformation(ctx: TickContext): Promise<TickHandlerResult> {
  const events = await ctx.db.worldEvent.findMany({
    where: {
      campaignId: ctx.campaignId,
      significant: true,
      turnNumber: { gte: ctx.turnNumber - PROPAGATION_WINDOW_TURNS },
    },
    select: { id: true, turnNumber: true, targetType: true, targetId: true },
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

  const npcTargetIds = events.filter((e) => e.targetType === 'NPC').map((e) => e.targetId)
  const warTargetIds = events.filter((e) => e.targetType === 'WAR').map((e) => e.targetId)

  const [npcs, wars, edges] = await Promise.all([
    npcTargetIds.length > 0
      ? ctx.db.nPC.findMany({ where: { id: { in: npcTargetIds } }, select: { id: true, locationId: true } })
      : Promise.resolve([]),
    warTargetIds.length > 0
      ? ctx.db.war.findMany({ where: { id: { in: warTargetIds } }, select: { id: true, contestedLocationId: true } })
      : Promise.resolve([]),
    ctx.db.locationAdjacency.findMany({
      where: { campaignId: ctx.campaignId },
      select: { locationAId: true, locationBId: true, distance: true },
    }),
  ])
  const npcLocationById = new Map(npcs.map((n) => [n.id, n.locationId]))
  const warLocationById = new Map(wars.map((w) => [w.id, w.contestedLocationId]))

  const eventInputs: InformationSpreadEventInput[] = events.map((event) => {
    let originLocationId: string | null = null
    if (event.targetType === 'NPC') originLocationId = npcLocationById.get(event.targetId) ?? null
    else if (LOCATION_TARGET_TYPES.includes(event.targetType)) originLocationId = event.targetId
    else if (event.targetType === 'WAR') originLocationId = warLocationById.get(event.targetId) ?? null
    return { worldEventId: event.id, turnNumber: event.turnNumber, originLocationId }
  })

  const decisions = decideInformationSpread({
    currentTurn: ctx.turnNumber,
    events: eventInputs,
    characters: characters.map((c) => ({ characterId: c.id, locationId: c.locationId })),
    coveredPairs,
    edges: edges as AdjacencyEdge[],
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
