// src/lib/game/tick/factionTick.ts
// World Sim Phase 1 — Faction state, driven by `goal`, not randomly.
// World Sim Phase 3 — `goal` itself is reassessed automatically every tick
// from the faction's resulting stats (see decideFactionGoalReassessment
// below), not just set once by a GM and left alone. The admin panel's goal
// picker still exists as a seed/override, but expect the simulation to
// steer it back toward whatever its circumstances justify.
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

type Band = 'LOW' | 'MEDIUM' | 'HIGH'

function band(value: number): Band {
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
// else, regardless of how rich or armed it is.
//
// DESTABILIZE_RIVAL is deliberately unreachable here — picking a rival to
// undermine requires knowing who the rivals are, and faction-to-faction
// relationships aren't tracked yet (see the README roadmap, Phase 3). Until
// then it's only reachable by a GM setting it directly, and this
// reassessment will leave it alone unless stability or resources fall low
// enough to override it below.
//
/** Pure decision function — no DB access, safe to unit test directly. */
export function decideFactionGoalReassessment(faction: {
  resources: number
  stability: number
  military: number
  goal: FactionGoal
}): FactionGoal {
  const stabilityBand = band(faction.stability)
  const resourcesBand = band(faction.resources)
  const militaryBand = band(faction.military)

  // Internal cohesion is failing — shore it up before anything ambitious.
  if (stabilityBand === 'LOW') return 'DEFEND'
  // Too poor to attempt anything ambitious — rebuild the treasury first.
  if (resourcesBand === 'LOW') return 'ENRICH'
  // Strong on every front that matters for pushing outward — safe to expand.
  if (militaryBand === 'HIGH' && resourcesBand === 'HIGH') return 'EXPAND'
  // Otherwise, hold what it has.
  return 'CONSOLIDATE'
}

export async function tickFactions(ctx: TickContext): Promise<TickHandlerResult> {
  const factions = await prisma.faction.findMany({
    where: { campaignId: ctx.campaignId },
    orderBy: { createdAt: 'asc' },
    take: FACTION_CAP,
  })

  const changes: WorldChange[] = []

  for (const faction of factions) {
    const next = decideFactionTick(faction)
    // DESTABILIZE_RIVAL is a GM-set-only goal for now (see comment above) —
    // reassessment never picks it, but it also never overrides it unless a
    // higher-priority crisis (low stability/resources) demands it.
    const nextGoal =
      faction.goal === 'DESTABILIZE_RIVAL' && band(next.stability) !== 'LOW' && band(next.resources) !== 'LOW'
        ? faction.goal
        : decideFactionGoalReassessment({ ...next, goal: faction.goal })

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
