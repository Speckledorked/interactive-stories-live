// src/lib/game/tick/factionTick.ts
// World Sim Phase 1 — Faction state, driven by `goal`, not randomly.
//
// Each goal applies a small fixed delta to the 4 tracked fields
// (resources, stability, military — goal itself only changes when a GM or
// future system sets it explicitly, ticks never change a faction's goal).
// Capped at 10 factions per campaign, consistent with existing campaign
// scale elsewhere in the codebase.

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

export async function tickFactions(ctx: TickContext): Promise<TickHandlerResult> {
  const factions = await prisma.faction.findMany({
    where: { campaignId: ctx.campaignId },
    orderBy: { createdAt: 'asc' },
    take: FACTION_CAP,
  })

  const changes: WorldChange[] = []

  for (const faction of factions) {
    const next = decideFactionTick(faction)

    await prisma.faction.update({
      where: { id: faction.id },
      data: {
        resources: next.resources,
        stability: next.stability,
        military: next.military,
      },
    })

    changes.push(
      ...buildFactionChanges(ctx.campaignId, faction, next)
    )
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
