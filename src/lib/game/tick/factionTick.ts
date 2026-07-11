// src/lib/game/tick/factionTick.ts
// World Sim Phase 1 — Faction state, driven by `goal`, not randomly.
// World Sim Phase 3 — `goal` itself is reassessed automatically every tick
// from the faction's resulting stats (see decideFactionGoalReassessment
// below), not just set once by a GM and left alone. The admin panel's goal
// picker still exists as a seed/override, but expect the simulation to
// steer it back toward whatever its circumstances justify. This file also
// owns the two lifecycle events that can end or begin a faction's
// independent existence: collapse (absorbed by a rival, or succeeded by a
// smaller remnant) and the founding that comes out of it.
//
// Each goal applies a small fixed delta to the 4 tracked fields (resources,
// stability, military). Capped at 10 factions per campaign, consistent with
// existing campaign scale elsewhere in the codebase.

import { prisma } from '@/lib/prisma'
import type { Faction, FactionGoal } from '@prisma/client'
import { TickContext, TickHandlerResult, WorldChange, clamp } from './types'

const FACTION_CAP = 10

interface FactionDelta {
  resources: number
  stability: number
  military: number
}

// Deterministic — same goal always produces the same delta. This is the
// entire "based on their goal, not randomly" requirement.
const GOAL_DELTAS: Record<FactionGoal, FactionDelta> = {
  EXPAND: { resources: -3, stability: -1, military: 2 },
  DEFEND: { resources: -1, stability: 2, military: 1 },
  ENRICH: { resources: 4, stability: 1, military: -1 },
  DESTABILIZE_RIVAL: { resources: -2, stability: -1, military: 1 },
  CONSOLIDATE: { resources: 1, stability: 2, military: 0 },
}

export type Band = 'LOW' | 'MEDIUM' | 'HIGH'

// Exported — relationshipTick.ts shares this exact banding so "stable" means
// the same thing everywhere in the tick.
export function band(value: number): Band {
  if (value < 34) return 'LOW'
  if (value <= 66) return 'MEDIUM'
  return 'HIGH'
}

export interface FactionTickDecision {
  resources: number
  stability: number
  military: number
}

/** Pure decision function — no DB access, safe to unit test directly. */
export function decideFactionTick(faction: {
  resources: number
  stability: number
  military: number
  goal: FactionGoal
}): FactionTickDecision {
  const delta = GOAL_DELTAS[faction.goal]
  return {
    resources: clamp(faction.resources + delta.resources, 0, 100),
    stability: clamp(faction.stability + delta.stability, 0, 100),
    military: clamp(faction.military + delta.military, 0, 100),
  }
}

// Priority order matters: a faction in crisis fixes that before anything
// else, regardless of how rich or armed it is. DESTABILIZE_RIVAL only
// becomes reachable once the faction actually has a rival on record (see
// relationshipTick.ts) — otherwise there's nothing for it to mean.
/** Pure decision function — no DB access, safe to unit test directly. */
export function decideFactionGoalReassessment(faction: {
  resources: number
  stability: number
  military: number
  goal: FactionGoal
  hasRival: boolean
}): FactionGoal {
  const stabilityBand = band(faction.stability)
  const resourcesBand = band(faction.resources)
  const militaryBand = band(faction.military)

  // Internal cohesion is failing — shore it up before anything ambitious.
  if (stabilityBand === 'LOW') return 'DEFEND'
  // Too poor to attempt anything ambitious — rebuild the treasury first.
  if (resourcesBand === 'LOW') return 'ENRICH'
  // Strong enough to act, and there's a known rival to act against —
  // prioritized over blind expansion, since undermining a specific
  // competitor is more strategically pointed than generic growth.
  if (faction.hasRival && militaryBand === 'HIGH') return 'DESTABILIZE_RIVAL'
  // Strong on every front that matters for pushing outward — safe to expand.
  if (militaryBand === 'HIGH' && resourcesBand === 'HIGH') return 'EXPAND'
  // Otherwise, hold what it has.
  return 'CONSOLIDATE'
}

const COLLAPSE_STABILITY_THRESHOLD = 10
const ABSORPTION_TRANSFER_RATE = 0.3

export interface FactionCollapseDecision {
  collapses: boolean
  transferResources: number
  transferMilitary: number
}

// A faction that bottoms out doesn't just sit at LOW forever — past a
// deeper crisis point it stops existing as an independent actor. If it has
// a rival on record, that rival absorbs a slice of what's left; otherwise
// it founds a successor (see decideFactionFounding below).
/** Pure decision function — no DB access, safe to unit test directly. */
export function decideFactionCollapse(faction: {
  stability: number
  resources: number
  military: number
}): FactionCollapseDecision {
  if (faction.stability > COLLAPSE_STABILITY_THRESHOLD) {
    return { collapses: false, transferResources: 0, transferMilitary: 0 }
  }
  return {
    collapses: true,
    transferResources: Math.round(faction.resources * ABSORPTION_TRANSFER_RATE),
    transferMilitary: Math.round(faction.military * ABSORPTION_TRANSFER_RATE),
  }
}

const SUCCESSOR_INHERITANCE_RATE = 0.4
// Deliberately NOT a fraction of the collapsed faction's stability — that
// value is at or below COLLAPSE_STABILITY_THRESHOLD by definition, so
// inheriting a percentage of it would found a successor already in crisis,
// which would immediately re-collapse next tick. A successor state starts
// humbled but functional, not stillborn.
const SUCCESSOR_STARTING_STABILITY = 40

export interface FactionFoundingDecision {
  name: string
  resources: number
  stability: number
  military: number
}

// A collapsing faction with no rival to absorb it doesn't just vanish — a
// smaller successor rises from the wreckage instead, carrying forward only
// a fraction of its predecessor's wealth and military capacity.
/** Pure decision function — no DB access, safe to unit test directly. */
export function decideFactionFounding(collapsedFaction: {
  name: string
  resources: number
  military: number
}): FactionFoundingDecision {
  return {
    name: `${collapsedFaction.name} Remnant`,
    resources: Math.round(collapsedFaction.resources * SUCCESSOR_INHERITANCE_RATE),
    stability: SUCCESSOR_STARTING_STABILITY,
    military: Math.round(collapsedFaction.military * SUCCESSOR_INHERITANCE_RATE),
  }
}

export async function tickFactions(ctx: TickContext): Promise<TickHandlerResult> {
  const factions = await prisma.faction.findMany({
    where: { campaignId: ctx.campaignId, isActive: true },
    orderBy: { createdAt: 'asc' },
    take: FACTION_CAP,
  })

  const changes: WorldChange[] = []

  for (const faction of factions) {
    const next = decideFactionTick(faction)
    const relationships = (faction.relationships as Record<string, { type: string }>) || {}
    const collapse = decideFactionCollapse(next)

    if (collapse.collapses) {
      const rivalId = Object.entries(relationships).find(([, r]) => r.type === 'RIVAL')?.[0]
      const absorber = rivalId ? await prisma.faction.findUnique({ where: { id: rivalId } }) : null

      let successorName: string | null = null

      if (absorber?.isActive) {
        await prisma.faction.update({
          where: { id: absorber.id },
          data: {
            resources: clamp(absorber.resources + collapse.transferResources, 0, 100),
            military: clamp(absorber.military + collapse.transferMilitary, 0, 100),
          },
        })

        // Members defect to whoever absorbed their faction — demoted to
        // MEMBER regardless of prior role, since the absorbing faction
        // already has its own leadership; tickFactionLeadership will fill
        // any resulting gap there if it somehow doesn't.
        await prisma.nPC.updateMany({
          where: { factionId: faction.id },
          data: { factionId: absorber.id, factionRole: 'MEMBER' },
        })
      } else {
        // No rival to absorb it — a smaller successor rises from the
        // wreckage instead of the faction simply vanishing.
        const successor = decideFactionFounding({ name: faction.name, resources: next.resources, military: next.military })
        const createdSuccessor = await prisma.faction.create({
          data: {
            campaignId: ctx.campaignId,
            name: successor.name,
            resources: successor.resources,
            stability: successor.stability,
            military: successor.military,
            goal: 'CONSOLIDATE',
            archetype: faction.archetype,
            threatLevel: 1,
            isActive: true,
          },
        })
        successorName = successor.name

        // Members carry over to the remnant with their existing roles —
        // it's the same people, just organized smaller.
        await prisma.nPC.updateMany({
          where: { factionId: faction.id },
          data: { factionId: createdSuccessor.id },
        })
      }

      await prisma.faction.update({
        where: { id: faction.id },
        data: { resources: next.resources, stability: next.stability, military: next.military, isActive: false },
      })

      changes.push({
        entityType: 'FACTION',
        entityId: faction.id,
        entityName: faction.name,
        campaignId: ctx.campaignId,
        field: 'collapsed',
        previousValue: 'active',
        newValue: absorber?.isActive ? 'absorbed' : 'succeeded',
        reason: absorber?.isActive
          ? `${faction.name} collapses under its own instability and is absorbed by ${absorber.name}`
          : `${faction.name} collapses under its own instability; ${successorName} rises from the wreckage`,
        significant: true,
        importance: 'MAJOR',
      })

      // Skip normal goal reassignment/stat-band logging for a faction that
      // no longer exists as an independent actor as of this tick.
      continue
    }

    const factionHasRival = Object.values(relationships).some((r) => r.type === 'RIVAL')
    const nextGoal = decideFactionGoalReassessment({ ...next, goal: faction.goal, hasRival: factionHasRival })

    await prisma.faction.update({
      where: { id: faction.id },
      data: {
        resources: next.resources,
        stability: next.stability,
        military: next.military,
        goal: nextGoal,
      },
    })

    changes.push(
      ...buildFactionChanges(ctx.campaignId, faction, next)
    )

    if (nextGoal !== faction.goal) {
      changes.push({
        entityType: 'FACTION',
        entityId: faction.id,
        entityName: faction.name,
        campaignId: ctx.campaignId,
        field: 'goal',
        previousValue: faction.goal,
        newValue: nextGoal,
        reason: `${faction.name}'s circumstances shifted its priorities from ${faction.goal} to ${nextGoal}`,
        significant: true,
        importance: 'NORMAL',
      })
    }
  }

  return { changes }
}

// A field is only "significant" (worth a history entry) when it crosses a
// LOW/MEDIUM/HIGH band boundary — small +/-1..4 nudges every tick would
// otherwise flood the log.
function buildFactionChanges(
  campaignId: string,
  faction: Faction,
  next: FactionTickDecision
): WorldChange[] {
  const changes: WorldChange[] = []
  const fields: Array<{ key: keyof FactionTickDecision; label: string; prev: number }> = [
    { key: 'resources', label: 'resources', prev: faction.resources },
    { key: 'stability', label: 'stability', prev: faction.stability },
    { key: 'military', label: 'military', prev: faction.military },
  ]

  for (const field of fields) {
    const prevBand = band(field.prev)
    const nextBand = band(next[field.key])
    if (prevBand === nextBand) continue

    changes.push({
      entityType: 'FACTION',
      entityId: faction.id,
      entityName: faction.name,
      campaignId,
      field: field.label,
      previousValue: field.prev,
      newValue: next[field.key],
      reason: `${faction.name}'s ${field.label} moved from ${prevBand} to ${nextBand} while pursuing ${faction.goal}`,
      significant: true,
      importance: nextBand === 'LOW' ? 'MAJOR' : 'NORMAL',
    })
  }

  return changes
}
