// src/lib/game/tick/ambitionTick.ts
// World Sim Phase 2 — factions autonomously commit to a major ambition
// while pursuing an outward-looking goal (EXPAND, ENRICH), so events like
// a region-wide tournament or a war of conquest can originate from
// simulation instead of requiring a GM to set one up by hand.
//
// Split responsibility, on purpose: this handler deterministically decides
// WHETHER a faction commits to something big this tick (resources high
// enough, goal ambitious enough, not already mid-ambition) and what the
// mechanical shape of it is (how long it takes, how urgently it ticks).
// It does NOT decide the specific flavor (tournament vs. trade fair vs.
// festival) — that's left to the offscreen AI narration path in
// worldTurn.ts, which has the context and creativity to pick something
// that fits the moment and doesn't repeat what's already happened. This
// handler hands off a PendingAmbition with a deterministic fallback name,
// so if the AI call fails or skips it, the ambition still becomes a real
// Clock instead of silently vanishing.
//
// A faction commits to at most one ambition at a time: once it has an
// active (incomplete) spawned clock, this handler leaves it alone until
// that clock resolves.

import { prisma } from '@/lib/prisma'
import type { FactionGoal } from '@prisma/client'
import { TickContext, TickHandlerResult, WorldChange, PendingAmbition } from './types'

const FACTION_CAP = 10
const RESOURCES_HIGH_THRESHOLD = 67 // matches factionTick.ts's band() HIGH cutoff

interface AmbitionShape {
  fallbackNameSuffix: string
  maxTicks: number
  category: string
  fallbackConsequence: (factionName: string) => string
}

// Bounded flavor options the offscreen AI narration path picks from for
// each pending ambition (see worldTurn.ts) — deliberately a fixed list,
// not free invention, so the AI can't wander off-tone or produce something
// unparseable. Exported so client.ts's prompt builder and worldTurn.ts's
// validation share one source of truth instead of two lists drifting apart.
export const AMBITION_CATEGORY_OPTIONS: Record<'ENRICH' | 'EXPAND', string[]> = {
  ENRICH: ['tournament', 'trade fair', 'harvest festival', 'trading expedition', 'grand bazaar', 'founding feast'],
  EXPAND: ['military campaign', 'border annexation', 'colonization venture', 'punitive raid', 'siege preparation'],
}

// Only the two outward-looking goals commit to ambitions; DEFEND/
// CONSOLIDATE/DESTABILIZE_RIVAL are internal or reactive, not the kind of
// thing that produces a headline event on its own.
const AMBITION_SHAPES: Partial<Record<FactionGoal, AmbitionShape>> = {
  ENRICH: {
    fallbackNameSuffix: 'Grand Tournament',
    maxTicks: 6,
    category: 'social',
    fallbackConsequence: (name) => `${name} crowns a champion, and its coffers and reputation grow.`,
  },
  EXPAND: {
    fallbackNameSuffix: 'Territorial Campaign',
    maxTicks: 8,
    category: 'urgent',
    fallbackConsequence: (name) => `${name} claims new territory, reshaping the region's balance of power.`,
  },
}

export interface AmbitionDecision {
  shouldSpawn: boolean
  maxTicks: number
  category: string
  fallbackName: string
  fallbackConsequence: string
}

/** Pure decision function — no DB access, safe to unit test directly. */
export function decideAmbitionTick(faction: {
  name: string
  goal: FactionGoal
  resources: number
  hasActiveSpawnedClock: boolean
}): AmbitionDecision {
  const shape = AMBITION_SHAPES[faction.goal]
  const shouldSpawn =
    !!shape &&
    faction.resources >= RESOURCES_HIGH_THRESHOLD &&
    !faction.hasActiveSpawnedClock

  if (!shouldSpawn || !shape) {
    return { shouldSpawn: false, maxTicks: 0, category: '', fallbackName: '', fallbackConsequence: '' }
  }

  return {
    shouldSpawn: true,
    maxTicks: shape.maxTicks,
    category: shape.category,
    fallbackName: `${faction.name} ${shape.fallbackNameSuffix}`,
    fallbackConsequence: shape.fallbackConsequence(faction.name),
  }
}

export async function tickFactionAmbitions(ctx: TickContext): Promise<TickHandlerResult> {
  const factions = await prisma.faction.findMany({
    where: {
      campaignId: ctx.campaignId,
      goal: { in: ['ENRICH', 'EXPAND'] },
    },
    orderBy: { createdAt: 'asc' },
    take: FACTION_CAP,
    include: {
      spawnedClocks: {
        select: { currentTicks: true, maxTicks: true },
      },
    },
  })

  const changes: WorldChange[] = []
  const pendingAmbitions: PendingAmbition[] = []

  for (const faction of factions) {
    const hasActiveSpawnedClock = faction.spawnedClocks.some((c) => c.currentTicks < c.maxTicks)
    const decision = decideAmbitionTick({
      name: faction.name,
      goal: faction.goal,
      resources: faction.resources,
      hasActiveSpawnedClock,
    })

    if (!decision.shouldSpawn) continue

    pendingAmbitions.push({
      factionId: faction.id,
      factionName: faction.name,
      goal: faction.goal,
      maxTicks: decision.maxTicks,
      category: decision.category,
      fallbackName: decision.fallbackName,
      fallbackConsequence: decision.fallbackConsequence,
    })

    changes.push({
      entityType: 'FACTION',
      entityId: faction.id,
      entityName: faction.name,
      campaignId: ctx.campaignId,
      field: 'ambitionCommitted',
      previousValue: '(none)',
      newValue: '(taking shape)',
      reason: `${faction.name} committed its resources to a major undertaking while pursuing ${faction.goal}`,
      significant: true,
      importance: 'MAJOR',
    })
  }

  return { changes, pendingAmbitions }
}
