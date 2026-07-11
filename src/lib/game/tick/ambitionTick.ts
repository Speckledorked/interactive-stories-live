// src/lib/game/tick/ambitionTick.ts
// World Sim Phase 2 — factions autonomously commit to a major ambition
// while pursuing an outward-looking goal (EXPAND, ENRICH, and — Phase 3 —
// DESTABILIZE_RIVAL once relationshipTick.ts gives them a rival to target),
// so events like a region-wide tournament, a war of conquest, or a smear
// campaign can originate from simulation instead of requiring a GM to set
// one up by hand.
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
import { TickContext, TickHandlerResult, WorldChange, PendingAmbition, clamp, stableHash } from './types'

const RESOURCES_HIGH_THRESHOLD = 67 // matches factionTick.ts's band() HIGH cutoff

// Committing to an ambition spends resources rather than only requiring a
// threshold — otherwise an ENRICH faction drifting +4 resources/turn could
// chain straight from one ambition into the next as soon as its cooldown
// clock resolved, for free.
const AMBITION_COMMIT_COST = 20

type AmbitionGoal = 'ENRICH' | 'EXPAND' | 'DESTABILIZE_RIVAL'

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
  DESTABILIZE_RIVAL: {
    maxTicks: 5,
    category: 'urgent',
    fallbackConsequence: (name) => `${name} deals a blow to its rival's standing, and returns stronger for the effort.`,
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
    DESTABILIZE_RIVAL: ['sabotage campaign', 'smear campaign', 'economic blockade', 'spy infiltration', 'bribery scheme'],
  },
  SECRET_SOCIETY: {
    ENRICH: ['black-market venture', 'blackmail operation', 'smuggling run', 'ritual convocation', 'wealthy patron courting'],
    EXPAND: ['infiltration operation', 'recruitment drive', 'rival cell takeover', 'covert coup', 'network expansion'],
    DESTABILIZE_RIVAL: ['shadow war', 'double agent placement', 'ritual curse', 'discrediting operation', 'rival unmasking'],
  },
  CRIMINAL: {
    ENRICH: ['heist', 'smuggling run', 'extortion racket', 'black-market auction', 'protection racket expansion'],
    EXPAND: ['turf war', 'rival takeover', 'territory grab', 'safehouse network expansion', 'bribery campaign'],
    DESTABILIZE_RIVAL: ['rival gang war', 'hit job', 'territory sabotage', 'informant planting', 'supply line disruption'],
  },
  RELIGIOUS: {
    ENRICH: ['pilgrimage', 'grand festival', 'relic unveiling', 'tithe drive', 'temple consecration'],
    EXPAND: ['missionary campaign', 'conversion crusade', 'new temple founding', 'holy war', 'schism suppression'],
    DESTABILIZE_RIVAL: ['heresy accusation', 'holy inquisition', 'schism incitement', 'excommunication campaign', 'relic theft'],
  },
  MILITARY: {
    ENRICH: ['mercenary contract', 'war games tournament', 'weapons fair', 'veteran recruitment gala'],
    EXPAND: ['military campaign', 'siege preparation', 'border annexation', 'garrison expansion', 'punitive raid'],
    DESTABILIZE_RIVAL: ['covert strike', 'proxy war', 'supply line raid', 'defector recruitment', 'intelligence operation'],
  },
  CORPORATION: {
    ENRICH: ['product launch', 'trade expo', 'shareholder gala', 'merger negotiation', 'ipo campaign'],
    EXPAND: ['hostile takeover', 'market expansion', 'new facility opening', 'competitor buyout', 'lobbying campaign'],
    DESTABILIZE_RIVAL: ['hostile PR campaign', 'patent sabotage', 'talent poaching raid', 'regulatory complaint', 'supply chain disruption'],
  },
  POLITICAL: {
    ENRICH: ['fundraising gala', 'campaign rally', 'endorsement drive', 'coalition summit'],
    EXPAND: ['election campaign', 'coup attempt', 'redistricting push', 'party expansion', 'no-confidence campaign'],
    DESTABILIZE_RIVAL: ['smear campaign', 'scandal exposure', 'voter suppression scheme', 'defection courting', 'no-confidence maneuvering'],
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
  resourceCost: number
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
    return { shouldSpawn: false, maxTicks: 0, category: '', fallbackFlavor: '', fallbackName: '', fallbackConsequence: '', resourceCost: 0 }
  }

  const fallbackFlavor = flavorOptions[0]

  return {
    shouldSpawn: true,
    maxTicks: shape.maxTicks,
    category: shape.category,
    fallbackFlavor,
    fallbackName: `${faction.name} ${titleCase(fallbackFlavor)}`,
    fallbackConsequence: shape.fallbackConsequence(faction.name),
    resourceCost: AMBITION_COMMIT_COST,
  }
}

export async function tickFactionAmbitions(ctx: TickContext): Promise<TickHandlerResult> {
  const factions = await prisma.faction.findMany({
    where: {
      campaignId: ctx.campaignId,
      isActive: true,
      goal: { in: ['ENRICH', 'EXPAND', 'DESTABILIZE_RIVAL'] },
    },
    orderBy: { createdAt: 'asc' },
    take: ctx.factionCap,
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

    // DESTABILIZE_RIVAL ambitions get aimed at whichever faction is on
    // record as a rival, so resolution can apply real damage to a specific
    // named faction instead of only affecting the one that committed to it.
    let targetFactionId: string | undefined
    let targetFactionName: string | undefined
    if (faction.goal === 'DESTABILIZE_RIVAL') {
      const relationships = (faction.relationships as any as Record<string, { type: string }>) || {}
      const rivalId = Object.entries(relationships).find(([, r]) => r.type === 'RIVAL')?.[0]
      const rival = rivalId ? await prisma.faction.findUnique({ where: { id: rivalId } }) : null
      if (rival?.isActive) {
        targetFactionId = rival.id
        targetFactionName = rival.name
      }
    }

    const resourcesAfterCost = clamp(faction.resources - decision.resourceCost, 0, 100)
    if (!ctx.dryRun) {
      await prisma.faction.update({
        where: { id: faction.id },
        data: { resources: resourcesAfterCost },
      })
    }

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
      targetFactionId,
      targetFactionName,
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

    changes.push({
      entityType: 'FACTION',
      entityId: faction.id,
      entityName: faction.name,
      campaignId: ctx.campaignId,
      field: 'resources',
      previousValue: faction.resources,
      newValue: resourcesAfterCost,
      reason: `${faction.name} spent ${decision.resourceCost} resources committing to this ambition`,
      significant: false,
      importance: 'NORMAL',
    })
  }

  return { changes, pendingAmbitions }
}

export interface AmbitionOutcome {
  success: boolean
  resourceDelta: number
  stabilityDelta: number
  militaryDelta: number
  threatLevelDelta: number
  consequenceText: string
  /** Only ever non-zero for a successful DESTABILIZE_RIVAL outcome with a named target — see resolveCompletedAmbitions in worldTurn.ts, which applies these to the target faction, not the acting one. A failed scheme never reaches the target at all. */
  targetStabilityDelta: number
  targetResourceDelta: number
}

// Success chance scales with whichever stat the goal actually leans on —
// military for a campaign of conquest, resources for a tournament/trade
// venture — so a faction that's already strong where it counts is more
// likely to pull it off, but never guaranteed (40-90% band) and never
// hopeless even when weak. Deterministic via stableHash seeded by the
// faction+clock pair, so the same ambition always resolves the same way;
// no Math.random(), consistent with the rest of the tick.
const SUCCESS_FLOOR = 40
const SUCCESS_CEILING = 90
const SUCCESS_STAT_WEIGHT = 0.5

/** Pure decision function — no DB access, safe to unit test directly. */
export function decideAmbitionOutcome(input: {
  factionId: string
  clockId: string
  factionName: string
  goal: FactionGoal
  resources: number
  military: number
  /** Only meaningful for DESTABILIZE_RIVAL — the rival this ambition is aimed at, if one was on record when it was committed to. */
  targetFactionName?: string
}): AmbitionOutcome {
  const relevantStat = input.goal === 'EXPAND' || input.goal === 'DESTABILIZE_RIVAL' ? input.military : input.resources
  const successChance = clamp(SUCCESS_FLOOR + relevantStat * SUCCESS_STAT_WEIGHT, SUCCESS_FLOOR, SUCCESS_CEILING)
  const roll = stableHash(`${input.factionId}:${input.clockId}`) % 100
  const success = roll < successChance

  if (input.goal === 'EXPAND') {
    return success
      ? { success: true, resourceDelta: 0, stabilityDelta: -2, militaryDelta: 6, threatLevelDelta: 1, targetStabilityDelta: 0, targetResourceDelta: 0, consequenceText: `${input.factionName} claims new ground, reshaping the region's balance of power.` }
      : { success: false, resourceDelta: -8, stabilityDelta: -4, militaryDelta: -3, threatLevelDelta: 0, targetStabilityDelta: 0, targetResourceDelta: 0, consequenceText: `${input.factionName} overextends and is thrown back, its ambitions costing more than they gained.` }
  }

  if (input.goal === 'DESTABILIZE_RIVAL') {
    const rival = input.targetFactionName || 'its rival'
    // A failed scheme never reaches the target at all — it unravels before
    // doing any real damage, hence targetDeltas of 0 on the failure branch.
    return success
      ? { success: true, resourceDelta: -3, stabilityDelta: 1, militaryDelta: 2, threatLevelDelta: 1, targetStabilityDelta: -4, targetResourceDelta: -3, consequenceText: `${input.factionName} deals a blow to ${rival}'s standing, and returns stronger for the effort.` }
      : { success: false, resourceDelta: -5, stabilityDelta: -3, militaryDelta: -4, threatLevelDelta: 0, targetStabilityDelta: 0, targetResourceDelta: 0, consequenceText: `${input.factionName}'s scheme against ${rival} unravels, costing it dearly.` }
  }

  return success
    ? { success: true, resourceDelta: 10, stabilityDelta: 2, militaryDelta: 0, threatLevelDelta: 1, targetStabilityDelta: 0, targetResourceDelta: 0, consequenceText: `${input.factionName} comes out ahead, and its coffers and reputation grow.` }
    : { success: false, resourceDelta: -6, stabilityDelta: -3, militaryDelta: 0, threatLevelDelta: 0, targetStabilityDelta: 0, targetResourceDelta: 0, consequenceText: `${input.factionName}'s effort falls flat, and the setback dents its standing.` }
}
