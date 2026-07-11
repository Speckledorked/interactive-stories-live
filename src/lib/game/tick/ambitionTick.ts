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
// black-market venture) — that's left to the offscreen AI narration path in
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
import type { FactionGoal, FactionArchetype } from '@prisma/client'
import { TickContext, TickHandlerResult, WorldChange, PendingAmbition } from './types'

const FACTION_CAP = 10
const RESOURCES_HIGH_THRESHOLD = 67 // matches factionTick.ts's band() HIGH cutoff

type AmbitionGoal = 'ENRICH' | 'EXPAND'

// Mechanical shape of an ambition: how long it takes and how it resolves if
// nobody names it. Purely a function of the goal being pursued — a tournament
// and a black-market venture both driven by ENRICH tick at the same pace,
// because pacing is about the goal, not who's chasing it. This mechanical
// `category` is what gets persisted to Clock.category (drives tick speed in
// worldTurn.ts's advanceClocks) and must never be confused with the flavor
// category below, which is narrative only.
const AMBITION_SHAPES: Partial<Record<FactionGoal, { maxTicks: number; category: string; fallbackConsequence: (factionName: string) => string }>> = {
  ENRICH: {
    maxTicks: 6,
    category: 'social',
    fallbackConsequence: (name) => `${name} comes out ahead, and its coffers and reputation grow.`,
  },
  EXPAND: {
    maxTicks: 8,
    category: 'urgent',
    fallbackConsequence: (name) => `${name} claims new ground, reshaping the region's balance of power.`,
  },
}

// Bounded flavor options the offscreen AI narration path picks from for
// each pending ambition (see worldTurn.ts), keyed by what KIND of
// organization the faction is — a guild and a secret society can both
// pursue ENRICH, but a guild throws a trade fair and a secret society runs
// a black-market venture. Deliberately a fixed list per archetype, not free
// invention, so the AI can't wander off-tone or produce something
// unparseable. Exported so client.ts's prompt builder and worldTurn.ts's
// validation share one source of truth instead of two lists drifting apart.
// The first entry in each list also doubles as the deterministic fallback
// flavor if the AI call fails or skips a faction.
export const AMBITION_CATEGORY_OPTIONS: Record<FactionArchetype, Record<AmbitionGoal, string[]>> = {
  GENERIC: {
    ENRICH: ['tournament', 'trade fair', 'harvest festival', 'trading expedition', 'grand bazaar', 'founding feast'],
    EXPAND: ['military campaign', 'border annexation', 'colonization venture', 'punitive raid', 'siege preparation'],
  },
  SECRET_SOCIETY: {
    ENRICH: ['black-market venture', 'blackmail operation', 'smuggling run', 'ritual convocation', 'wealthy patron courting'],
    EXPAND: ['infiltration operation', 'recruitment drive', 'rival cell takeover', 'covert coup', 'network expansion'],
  },
  CRIMINAL: {
    ENRICH: ['heist', 'smuggling run', 'extortion racket', 'black-market auction', 'protection racket expansion'],
    EXPAND: ['turf war', 'rival takeover', 'territory grab', 'safehouse network expansion', 'bribery campaign'],
  },
  RELIGIOUS: {
    ENRICH: ['pilgrimage', 'grand festival', 'relic unveiling', 'tithe drive', 'temple consecration'],
    EXPAND: ['missionary campaign', 'conversion crusade', 'new temple founding', 'holy war', 'schism suppression'],
  },
  MILITARY: {
    ENRICH: ['mercenary contract', 'war games tournament', 'weapons fair', 'veteran recruitment gala'],
    EXPAND: ['military campaign', 'siege preparation', 'border annexation', 'garrison expansion', 'punitive raid'],
  },
  CORPORATION: {
    ENRICH: ['product launch', 'trade expo', 'shareholder gala', 'merger negotiation', 'ipo campaign'],
    EXPAND: ['hostile takeover', 'market expansion', 'new facility opening', 'competitor buyout', 'lobbying campaign'],
  },
  POLITICAL: {
    ENRICH: ['fundraising gala', 'campaign rally', 'endorsement drive', 'coalition summit'],
    EXPAND: ['election campaign', 'coup attempt', 'redistricting push', 'party expansion', 'no-confidence campaign'],
  },
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase())
}

export interface AmbitionDecision {
  shouldSpawn: boolean
  maxTicks: number
  category: string
  fallbackFlavor: string
  fallbackName: string
  fallbackConsequence: string
}

/** Pure decision function — no DB access, safe to unit test directly. */
export function decideAmbitionTick(faction: {
  name: string
  goal: FactionGoal
  archetype: FactionArchetype
  resources: number
  hasActiveSpawnedClock: boolean
}): AmbitionDecision {
  const shape = AMBITION_SHAPES[faction.goal]
  const flavorOptions = shape ? AMBITION_CATEGORY_OPTIONS[faction.archetype]?.[faction.goal as AmbitionGoal] : undefined
  const shouldSpawn =
    !!shape &&
    !!flavorOptions &&
    faction.resources >= RESOURCES_HIGH_THRESHOLD &&
    !faction.hasActiveSpawnedClock

  if (!shouldSpawn || !shape || !flavorOptions) {
    return { shouldSpawn: false, maxTicks: 0, category: '', fallbackFlavor: '', fallbackName: '', fallbackConsequence: '' }
  }

  const fallbackFlavor = flavorOptions[0]

  return {
    shouldSpawn: true,
    maxTicks: shape.maxTicks,
    category: shape.category,
    fallbackFlavor,
    fallbackName: `${faction.name} ${titleCase(fallbackFlavor)}`,
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
      archetype: faction.archetype,
      resources: faction.resources,
      hasActiveSpawnedClock,
    })

    if (!decision.shouldSpawn) continue

    pendingAmbitions.push({
      factionId: faction.id,
      factionName: faction.name,
      goal: faction.goal,
      archetype: faction.archetype,
      maxTicks: decision.maxTicks,
      category: decision.category,
      fallbackFlavor: decision.fallbackFlavor,
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
