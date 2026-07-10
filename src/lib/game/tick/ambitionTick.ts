// src/lib/game/tick/ambitionTick.ts
// World Sim Phase 2 — factions autonomously spawn Clocks while pursuing an
// ambitious goal (EXPAND, ENRICH), so events like a region-wide tournament
// or a war of conquest can originate from simulation instead of requiring
// a GM to set one up by hand.
//
// A faction spawns at most one ambition clock at a time: once it has an
// active (incomplete) spawned clock, this handler leaves it alone until
// that clock resolves. Clock completion is narrated and given lasting
// consequences by the existing offscreen-event AI path in worldTurn.ts —
// this handler only decides WHETHER and WHAT to spawn, deterministically.

import { prisma } from '@/lib/prisma'
import type { FactionGoal } from '@prisma/client'
import { TickContext, TickHandlerResult, WorldChange } from './types'

const FACTION_CAP = 10
const RESOURCES_HIGH_THRESHOLD = 67 // matches factionTick.ts's band() HIGH cutoff

interface AmbitionTemplate {
  nameSuffix: string
  maxTicks: number
  category: string
  consequence: (factionName: string) => string
}

// Only the two outward-looking goals spawn ambitions; DEFEND/CONSOLIDATE/
// DESTABILIZE_RIVAL are internal or reactive, not the kind of thing that
// produces a headline event on its own.
const AMBITION_TEMPLATES: Partial<Record<FactionGoal, AmbitionTemplate>> = {
  ENRICH: {
    nameSuffix: 'Grand Tournament',
    maxTicks: 6,
    category: 'social',
    consequence: (name) => `${name} crowns a champion, and its coffers and reputation grow.`,
  },
  EXPAND: {
    nameSuffix: 'Territorial Campaign',
    maxTicks: 8,
    category: 'urgent',
    consequence: (name) => `${name} claims new territory, reshaping the region's balance of power.`,
  },
}

export interface AmbitionDecision {
  shouldSpawn: boolean
  clockName: string
  maxTicks: number
  category: string
  consequence: string
}

/** Pure decision function — no DB access, safe to unit test directly. */
export function decideAmbitionTick(faction: {
  name: string
  goal: FactionGoal
  resources: number
  hasActiveSpawnedClock: boolean
}): AmbitionDecision {
  const template = AMBITION_TEMPLATES[faction.goal]
  const shouldSpawn =
    !!template &&
    faction.resources >= RESOURCES_HIGH_THRESHOLD &&
    !faction.hasActiveSpawnedClock

  if (!shouldSpawn || !template) {
    return { shouldSpawn: false, clockName: '', maxTicks: 0, category: '', consequence: '' }
  }

  return {
    shouldSpawn: true,
    clockName: `${faction.name} ${template.nameSuffix}`,
    maxTicks: template.maxTicks,
    category: template.category,
    consequence: template.consequence(faction.name),
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

  for (const faction of factions) {
    const hasActiveSpawnedClock = faction.spawnedClocks.some((c) => c.currentTicks < c.maxTicks)
    const decision = decideAmbitionTick({
      name: faction.name,
      goal: faction.goal,
      resources: faction.resources,
      hasActiveSpawnedClock,
    })

    if (!decision.shouldSpawn) continue

    const clock = await prisma.clock.create({
      data: {
        campaignId: ctx.campaignId,
        name: decision.clockName,
        description: `${faction.name} is pursuing this while resources allow.`,
        maxTicks: decision.maxTicks,
        category: decision.category,
        consequence: decision.consequence,
        sourceFactionId: faction.id,
      },
    })

    changes.push({
      entityType: 'FACTION',
      entityId: faction.id,
      entityName: faction.name,
      campaignId: ctx.campaignId,
      field: 'spawnedClock',
      previousValue: '(none)',
      newValue: clock.name,
      reason: `${faction.name} committed its resources to "${clock.name}" while pursuing ${faction.goal}`,
      significant: true,
      importance: 'MAJOR',
    })
  }

  return { changes }
}
