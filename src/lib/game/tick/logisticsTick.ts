// src/lib/game/tick/logisticsTick.ts
// World Sim #106 — resource infrastructure & logistics networks.
//
// Faction.resources changes today by abstract per-goal deltas only (see
// factionTick.ts's GOAL_DELTAS) — nothing about a faction's actual
// territory affects its wealth. This adds a real, if deliberately simple,
// mechanic: a location tagged with resourceSlots yields its owner a small
// resource gain each tick, but ONLY while at least one SupplyRoute
// touching it is unblockaded — owning a resource-rich location deep in
// contested territory doesn't help if nothing can move the goods out.
//
// Deliberately faction-resource-EXTRACTION only, per the decided scope —
// this is not a player-facing merchant/trading layer (see itemValue.ts's
// standing decision against prices/haggling/a shopping system) and must
// not be read as reopening that.
//
// Routes are flat and arbitrary on purpose: there's no real spatial/
// adjacency data anywhere in this codebase yet (a future WorldGraph, #108,
// would add that). decideExtraction below does NOT validate that a route
// actually reaches "the faction's core" in any pathfinding sense — it only
// checks that a route touches the resource location at all and isn't
// blockaded. That's the pathing-logic refinement #108 unlocks later; the
// schema (SupplyRoute rows) stays valid either way.
//
// isBlockaded is kept in sync here, each tick, from whichever locations
// are currently the contested prize of an ESCALATING war — the exact same
// war-presence signal tick/locationConditionTick.ts already established
// for #109 — rather than warTick.ts writing to it directly. This keeps
// war resolution's own responsibility (military outcomes) separate from
// this table's, and reuses a proven query instead of threading new
// same-tick plumbing through warTick.ts.

import { TickContext, TickHandlerResult, WorldChange, clamp } from './types'

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

/**
 * Pure — no DB access. A location yields its owner a resource gain only
 * when it has at least one resource slot, is actually owned, AND has at
 * least one unblockaded SupplyRoute touching it (as either endpoint — see
 * the module doc above on why the OTHER endpoint's ownership isn't
 * validated here).
 */
export function decideExtraction(locations: ExtractionLocation[], routes: SupplyRouteView[]): ExtractionDecision[] {
  const decisions: ExtractionDecision[] = []

  for (const location of locations) {
    if (location.resourceSlots.length === 0) continue
    if (!location.ownerFactionId) continue

    const hasWorkingRoute = routes.some(
      (r) => !r.isBlockaded && (r.fromLocationId === location.locationId || r.toLocationId === location.locationId)
    )
    if (!hasWorkingRoute) continue

    decisions.push({
      locationId: location.locationId,
      factionId: location.ownerFactionId,
      resourceGain: location.resourceSlots.length * RESOURCE_GAIN_PER_SLOT,
    })
  }

  return decisions
}

export async function tickLogistics(ctx: TickContext): Promise<TickHandlerResult> {
  const locations = await ctx.db.location.findMany({
    where: { campaignId: ctx.campaignId },
    select: { id: true, name: true, resourceSlots: true, ownerFactionId: true },
  })
  if (locations.length === 0) return { changes: [] }

  const routes = await ctx.db.supplyRoute.findMany({
    where: { campaignId: ctx.campaignId },
    select: { id: true, fromLocationId: true, toLocationId: true, isBlockaded: true },
  })

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

  const decisions = decideExtraction(
    locations.map((l) => ({ locationId: l.id, resourceSlots: l.resourceSlots, ownerFactionId: l.ownerFactionId })),
    routes
  )
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
