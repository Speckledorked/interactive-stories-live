// src/lib/game/tick/logisticsTick.ts
// World Sim #106 — resource infrastructure & logistics networks.
//
// Faction.resources changes today by abstract per-goal deltas only (see
// factionTick.ts's GOAL_DELTAS) — nothing about a faction's actual
// territory affects its wealth. This adds a real, if deliberately simple,
// mechanic: a location tagged with resourceSlots yields its owner a small
// resource gain each tick, but ONLY while it has a working (unblockaded,
// faction-connected) SupplyRoute — owning a resource-rich location deep in
// contested territory doesn't help if nothing can move the goods out.
//
// Deliberately faction-resource-EXTRACTION only, per the decided scope —
// this is not a player-facing merchant/trading layer (see itemValue.ts's
// standing decision against prices/haggling/a shopping system) and must
// not be read as reopening that.
//
// #108 follow-up (this codebase's own architecture audit): SupplyRoute
// rows were never actually created anywhere — no world-updater, no admin
// UI, no seed script ever calls supplyRoute.create. decideExtraction's
// gate could never fire in a real campaign; the mechanic shipped inert.
// This tick now DERIVES routes itself, the same way isBlockaded is
// already synced here rather than written by warTick.ts: each unrouted
// resource location gets connected to the nearest OTHER location the same
// faction owns, using the real adjacency graph (worldGraph.ts) when one
// exists for this campaign, falling back to an arbitrary-but-deterministic
// other owned location when it doesn't — adjacency-AWARE, not
// adjacency-DEPENDENT, matching every other #108 consumer's convention.
// Also closes the gap the original comment named directly: decideExtraction
// used to accept ANY unblockaded route touching the location regardless of
// where its other end went; it now requires that end to be a location the
// SAME faction currently owns — the "reaches the faction's core" check the
// comment said #108 would eventually unlock.
//
// isBlockaded is kept in sync here, each tick, from whichever locations
// are currently the contested prize of an ESCALATING war — the exact same
// war-presence signal tick/locationConditionTick.ts already established
// for #109 — rather than warTick.ts writing to it directly. This keeps
// war resolution's own responsibility (military outcomes) separate from
// this table's, and reuses a proven query instead of threading new
// same-tick plumbing through warTick.ts.

import { TickContext, TickHandlerResult, WorldChange, clamp } from './types'
import { AdjacencyEdge, nearestLocation } from '../worldGraph'

// Small, bounded per-slot gain — same rough scale as other tick deltas
// (GOAL_DELTAS's ENRICH is +4/turn; a worked resource slot adds to that,
// it doesn't dwarf it).
const RESOURCE_GAIN_PER_SLOT = 2

export interface ExtractionLocation {
  locationId: string
  resourceSlots: string[]
  ownerFactionId: string | null
}

export interface SupplyRouteView {
  fromLocationId: string
  toLocationId: string
  isBlockaded: boolean
}

export interface ExtractionDecision {
  locationId: string
  factionId: string
  resourceGain: number
}

/** The other end of `route` relative to `locationId`, or null if `route`
 * doesn't touch `locationId` at all. */
function otherEndOf(route: SupplyRouteView, locationId: string): string | null {
  if (route.fromLocationId === locationId) return route.toLocationId
  if (route.toLocationId === locationId) return route.fromLocationId
  return null
}

/**
 * Any route (blockaded or not) connecting `locationId` to another location
 * the SAME faction currently owns — "the infrastructure exists," independent
 * of whether it's currently usable. This is what decideSupplyRouteCreation
 * checks: a route under blockade needs the siege lifted, not a redundant
 * second route built alongside it every tick until it does.
 */
function hasAnyConnection(
  locationId: string,
  ownerFactionId: string,
  routes: SupplyRouteView[],
  ownerByLocationId: Map<string, string | null>,
  ownedLocationCount: number
): boolean {
  if (ownedLocationCount <= 1) return true
  return routes.some((r) => {
    const otherEnd = otherEndOf(r, locationId)
    return otherEnd !== null && ownerByLocationId.get(otherEnd) === ownerFactionId
  })
}

/**
 * A location has a WORKING route when it's the sole location its faction
 * owns (nothing to connect to — trivially self-sufficient) OR at least one
 * UNBLOCKADED route touches it whose OTHER end is a location the SAME
 * faction currently owns (per ownerByLocationId, so a route left over from
 * a since-changed ownership stops counting the moment that changes, with
 * no separate cleanup needed). This is the gate decideExtraction actually
 * uses — hasAnyConnection above is deliberately looser, for deciding
 * whether new infrastructure needs to be built at all.
 */
function hasWorkingRoute(
  locationId: string,
  ownerFactionId: string,
  routes: SupplyRouteView[],
  ownerByLocationId: Map<string, string | null>,
  ownedLocationCount: number
): boolean {
  if (ownedLocationCount <= 1) return true
  return routes.some((r) => {
    if (r.isBlockaded) return false
    const otherEnd = otherEndOf(r, locationId)
    return otherEnd !== null && ownerByLocationId.get(otherEnd) === ownerFactionId
  })
}

function countOwnedLocations(locations: ExtractionLocation[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const loc of locations) {
    if (!loc.ownerFactionId) continue
    counts.set(loc.ownerFactionId, (counts.get(loc.ownerFactionId) ?? 0) + 1)
  }
  return counts
}

/**
 * Pure — no DB access. A location yields its owner a resource gain only
 * when it has at least one resource slot, is actually owned, AND has a
 * working route (see hasWorkingRoute above).
 */
export function decideExtraction(locations: ExtractionLocation[], routes: SupplyRouteView[]): ExtractionDecision[] {
  const decisions: ExtractionDecision[] = []
  const ownerByLocationId = new Map(locations.map((l) => [l.locationId, l.ownerFactionId]))
  const ownedCounts = countOwnedLocations(locations)

  for (const location of locations) {
    if (location.resourceSlots.length === 0) continue
    if (!location.ownerFactionId) continue

    const ownedCount = ownedCounts.get(location.ownerFactionId) ?? 0
    if (!hasWorkingRoute(location.locationId, location.ownerFactionId, routes, ownerByLocationId, ownedCount)) continue

    decisions.push({
      locationId: location.locationId,
      factionId: location.ownerFactionId,
      resourceGain: location.resourceSlots.length * RESOURCE_GAIN_PER_SLOT,
    })
  }

  return decisions
}

export interface SupplyRouteCreation {
  fromLocationId: string
  toLocationId: string
  controllingFactionId: string
}

/**
 * Pure — which new SupplyRoute rows need to exist so that resource
 * locations with no infrastructure at all (per hasAnyConnection — a
 * currently-blockaded route still counts as existing infrastructure, just
 * temporarily unusable, and must NOT trigger building a redundant second
 * route alongside it every tick until the siege lifts) get one: connects
 * each such location to the nearest OTHER location its faction owns via
 * the real adjacency graph, or — when this campaign has no graph data
 * covering that location, or no path exists in it yet — an arbitrary but
 * deterministic other owned location, so the mechanic never silently
 * stalls on a campaign that hasn't had #108's graph backfilled.
 */
export function decideSupplyRouteCreation(
  locations: ExtractionLocation[],
  existingRoutes: SupplyRouteView[],
  edges: AdjacencyEdge[]
): SupplyRouteCreation[] {
  const creations: SupplyRouteCreation[] = []
  const ownerByLocationId = new Map(locations.map((l) => [l.locationId, l.ownerFactionId]))
  const ownedCounts = countOwnedLocations(locations)

  const ownedByFaction = new Map<string, string[]>()
  for (const loc of locations) {
    if (!loc.ownerFactionId) continue
    if (!ownedByFaction.has(loc.ownerFactionId)) ownedByFaction.set(loc.ownerFactionId, [])
    ownedByFaction.get(loc.ownerFactionId)!.push(loc.locationId)
  }

  // #246 (adversarial audit re-pass): same-tick consistency. hasAnyConnection
  // above only ever checks existingRoutes — the routes that existed BEFORE
  // this pass started — so without this, two resource locations owned by
  // the same faction that are each other's nearest neighbor, both starting
  // with no route at all, would each independently decide "I have no
  // connection, connect me to the nearest other owned location" and both
  // pick each other: two SupplyRoute rows for the same pair, created in the
  // same tick. Tracking which locations a creation decided earlier in THIS
  // pass already connects — and skipping a location once it's in this set —
  // closes that, the same "don't let an earlier decision in this pass go
  // unseen by a later one" shape factionTick.ts's #199 fix already uses.
  const connectedThisPass = new Set<string>()

  for (const location of locations) {
    if (location.resourceSlots.length === 0) continue
    if (!location.ownerFactionId) continue
    if (connectedThisPass.has(location.locationId)) continue

    const ownedCount = ownedCounts.get(location.ownerFactionId) ?? 0
    if (hasAnyConnection(location.locationId, location.ownerFactionId, existingRoutes, ownerByLocationId, ownedCount)) continue

    const otherOwned = (ownedByFaction.get(location.ownerFactionId) ?? []).filter((id) => id !== location.locationId)
    if (otherOwned.length === 0) continue

    const nearest = nearestLocation(edges, location.locationId, otherOwned)
    const targetId = nearest ? nearest.locationId : [...otherOwned].sort()[0]

    creations.push({
      fromLocationId: location.locationId,
      toLocationId: targetId,
      controllingFactionId: location.ownerFactionId,
    })
    connectedThisPass.add(location.locationId)
    connectedThisPass.add(targetId)
  }

  return creations
}

export async function tickLogistics(ctx: TickContext): Promise<TickHandlerResult> {
  const locations = await ctx.db.location.findMany({
    where: { campaignId: ctx.campaignId },
    select: { id: true, name: true, resourceSlots: true, ownerFactionId: true },
  })
  if (locations.length === 0) return { changes: [] }

  const [routes, adjacencyRows] = await Promise.all([
    ctx.db.supplyRoute.findMany({
      where: { campaignId: ctx.campaignId },
      select: { id: true, fromLocationId: true, toLocationId: true, isBlockaded: true },
    }),
    // #108: optional input to route creation below — falls back to an
    // arbitrary-but-deterministic other owned location when this is empty
    // or doesn't cover a given resource location, same convention as every
    // other #108 consumer (territory.ts, npcTick.ts).
    ctx.db.locationAdjacency.findMany({
      where: { campaignId: ctx.campaignId },
      select: { locationAId: true, locationBId: true, distance: true },
    }),
  ])

  const extractionLocations = locations.map((l) => ({
    locationId: l.id,
    resourceSlots: l.resourceSlots,
    ownerFactionId: l.ownerFactionId,
  }))

  const routeCreations = decideSupplyRouteCreation(extractionLocations, routes, adjacencyRows as AdjacencyEdge[])
  for (const creation of routeCreations) {
    if (!ctx.dryRun) {
      const created = await ctx.db.supplyRoute.create({
        data: {
          campaignId: ctx.campaignId,
          fromLocationId: creation.fromLocationId,
          toLocationId: creation.toLocationId,
          controllingFactionId: creation.controllingFactionId,
        },
        select: { id: true, fromLocationId: true, toLocationId: true, isBlockaded: true },
      })
      routes.push(created)
    } else {
      // No row to create in a dry run — reflect it in-memory only, so the
      // preview still shows what extraction would look like once this
      // route exists (isBlockaded defaults false, matching the schema).
      routes.push({ id: `dry-run-${creation.fromLocationId}-${creation.toLocationId}`, ...creation, isBlockaded: false } as any)
    }
  }

  // Sync blockade state from wars currently sieging a location — same
  // war-presence signal tickLocationCondition (#109) already reads.
  const escalatingWars = await ctx.db.war.findMany({
    where: { campaignId: ctx.campaignId, status: 'ESCALATING', contestedLocationId: { not: null } },
    select: { contestedLocationId: true },
  })
  const contestedLocationIds = new Set(escalatingWars.map((w) => w.contestedLocationId))

  for (const route of routes) {
    const shouldBeBlockaded = contestedLocationIds.has(route.fromLocationId) || contestedLocationIds.has(route.toLocationId)
    if (shouldBeBlockaded === route.isBlockaded) continue
    if (!ctx.dryRun) {
      await ctx.db.supplyRoute.update({ where: { id: route.id }, data: { isBlockaded: shouldBeBlockaded } })
    }
    // Reflect the change locally so decideExtraction below sees this
    // turn's fresh blockade state, not what was read at the top of the
    // handler.
    route.isBlockaded = shouldBeBlockaded
  }

  const decisions = decideExtraction(extractionLocations, routes)
  if (decisions.length === 0) return { changes: [] }

  const gainByFaction = new Map<string, number>()
  for (const decision of decisions) {
    gainByFaction.set(decision.factionId, (gainByFaction.get(decision.factionId) ?? 0) + decision.resourceGain)
  }

  const changes: WorldChange[] = []
  for (const [factionId, gain] of gainByFaction) {
    const faction = await ctx.db.faction.findUnique({
      where: { id: factionId },
      select: { id: true, name: true, resources: true, isActive: true },
    })
    if (!faction || !faction.isActive) continue

    const newResources = clamp(faction.resources + gain, 0, 100)
    if (newResources === faction.resources) continue

    if (!ctx.dryRun) {
      await ctx.db.faction.update({ where: { id: factionId }, data: { resources: newResources } })
    }

    changes.push({
      entityType: 'FACTION',
      entityId: faction.id,
      entityName: faction.name,
      campaignId: ctx.campaignId,
      field: 'resources',
      previousValue: faction.resources,
      newValue: newResources,
      reason: `${faction.name}'s worked territory delivers ${gain} resources over its supply lines`,
      // Routine background income, same significance tier as other small
      // per-tick numeric drifts (weatherTick's severity wobbles,
      // locationConditionTick's peacetime recovery) — not on its own worth
      // a history/RAG entry.
      significant: false,
      importance: 'NORMAL',
    })
  }

  return { changes }
}
