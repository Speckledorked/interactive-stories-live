// src/lib/game/tick/npcSocietyTick.ts
// Phase 9 — NPC society. Faction-level politics (relationshipTick.ts,
// factionTick.ts) is rich; individual NPCs had none of that texture of
// their own. This gives major NPCs (see MAJOR_IMPORTANCE_THRESHOLD)
// relationships to EACH OTHER, derived from — and consistent with — the
// faction politics that already exist:
//
//   social ties   — colleagues in the same faction are allies; members of
//                   rival/allied factions inherit that stance personally.
//                   Mirrors relationshipTick.ts's shape and philosophy,
//                   scoped to NPC pairs instead of faction pairs.
//   joint schemes — when two allied NPCs' independently-paced schedules
//                   both land on "acting" the same turn, they start
//                   working together on something concrete: a real Clock,
//                   tagged with both their ids. It rides the EXISTING
//                   generic clock advance/completion machinery
//                   (worldTurn.ts's advanceClocks, stateUpdater.ts's
//                   checkAndResolveCompletedClocks) — no new advancement
//                   logic needed, same as faction ambition clocks.
//
// Unaffiliated NPCs (no faction — a lone wolf, an independent operator)
// get a second, independent signal: their deterministic "home" location
// (the same stableHash(id) % locations formula npcTick.ts already uses for
// the day/night commute, re-derived here rather than stored, so it needs
// no new field). Two unaffiliated NPCs who share a home turf are grounded
// in something real about the fiction — sharing territory — which reads as
// community (ALLY) between ordinary NPCs, or turf rivalry (RIVAL) between
// two PbtA-style "threats" (NPC.threat set — predators competing for the
// same ground). One threat, one not: no clean signal, stays NEUTRAL. This
// is a second opinion, not a fallback guess — it only ever fires when the
// faction-derived signal (decideNpcSocialTie) has nothing to say, i.e. at
// least one side has no faction.
//
// Runs immediately after tickNpcs in the handler order (worldTick.ts):
// joint schemes read the ties this file just wrote in the same pass (no
// lag needed — unlike relationshipTick/factionTick, this isn't a circular
// dependency, just ties-then-consequences).

import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { TickContext, TickHandlerResult, WorldChange, parseFactionRelationships, stableHash } from './types'
import { tickPairwiseTies } from './relationshipEngine'
import { MAJOR_IMPORTANCE_THRESHOLD, isActingPhase } from './npcTick'

export type NpcSocialTieType = 'ALLY' | 'RIVAL' | 'NEUTRAL'

/**
 * Pure decision: what should the tie between two NPCs be, given their
 * faction affiliations and (if both are affiliated, with different
 * factions) the relationship between those factions?
 */
export function decideNpcSocialTie(
  a: { factionId: string | null },
  b: { factionId: string | null },
  factionRelationship: 'RIVAL' | 'ALLY' | 'NEUTRAL'
): NpcSocialTieType {
  if (a.factionId && a.factionId === b.factionId) return 'ALLY'
  if (!a.factionId || !b.factionId) return 'NEUTRAL'
  return factionRelationship
}

/**
 * Deterministic "home" location for tie-forming purposes — the exact same
 * formula npcTick.ts uses for the day/night commute (stableHash(id) %
 * sortedLocations.length), re-derived here rather than read off
 * NPC.currentLocation, which reflects wherever they happen to be THIS
 * turn's time-of-day, not their stable home base.
 */
export function deriveHomeLocation(npcId: string, sortedLocationNames: string[]): string | null {
  if (sortedLocationNames.length === 0) return null
  return sortedLocationNames[stableHash(npcId) % sortedLocationNames.length]
}

/**
 * Pure decision: the second-opinion tie for two NPCs with no faction-derived
 * signal (see the module doc above). sameHomeLocation must already account
 * for both being non-null — pass false when either has no derivable home.
 */
export function decideUnaffiliatedTie(
  a: { threat: string | null },
  b: { threat: string | null },
  sameHomeLocation: boolean
): NpcSocialTieType {
  if (!sameHomeLocation) return 'NEUTRAL'
  const aIsThreat = !!a.threat?.trim()
  const bIsThreat = !!b.threat?.trim()
  if (aIsThreat && bIsThreat) return 'RIVAL'
  if (!aIsThreat && !bIsThreat) return 'ALLY'
  return 'NEUTRAL'
}

export async function tickNpcSocialTies(ctx: TickContext): Promise<TickHandlerResult> {
  const [npcs, locations] = await Promise.all([
    prisma.nPC.findMany({
      where: { campaignId: ctx.campaignId, isAlive: true, importance: { gte: MAJOR_IMPORTANCE_THRESHOLD } },
      orderBy: { importance: 'desc' },
      take: ctx.npcCap,
      select: { id: true, name: true, factionId: true, threat: true, socialTies: true },
    }),
    prisma.location.findMany({ where: { campaignId: ctx.campaignId, isDiscovered: true }, select: { name: true } }),
  ])
  const sortedLocationNames = [...new Set(locations.map((l) => l.name))].sort()

  const factionIds = [...new Set(npcs.map((n) => n.factionId).filter((id): id is string => !!id))]
  const factions = factionIds.length > 0
    ? await prisma.faction.findMany({ where: { id: { in: factionIds } }, select: { id: true, relationships: true } })
    : []
  const factionRelById = new Map(factions.map((f) => [f.id, parseFactionRelationships(f.relationships)]))

  const factionRelationshipBetween = (aFactionId: string, bFactionId: string): 'RIVAL' | 'ALLY' | 'NEUTRAL' => {
    if (aFactionId === bFactionId) return 'NEUTRAL' // same-faction case handled separately by decideNpcSocialTie
    return factionRelById.get(aFactionId)?.[bFactionId]?.type ?? 'NEUTRAL'
  }

  const aliveNpcIds = new Set(npcs.map((n) => n.id))

  const { changes, working, dirty } = tickPairwiseTies({
    campaignId: ctx.campaignId,
    entityType: 'NPC',
    entities: npcs,
    turnNumber: ctx.turnNumber,
    getRawTies: (n) => n.socialTies,
    // Expire ties whose other NPC died, dropped below major importance, or
    // was otherwise removed from this tick's roster — without this a tie
    // to a dead NPC stays on record forever, since nothing else ever visits it.
    isValidOtherId: (otherId) => aliveNpcIds.has(otherId),
    decide: (a, b) => {
      const factionRel = a.factionId && b.factionId ? factionRelationshipBetween(a.factionId, b.factionId) : 'NEUTRAL'
      let freshType: NpcSocialTieType = decideNpcSocialTie(a, b, factionRel)

      // Second opinion for unaffiliated NPCs — only consulted when the
      // faction-derived signal has nothing to say (at least one side has
      // no faction, so decideNpcSocialTie already returned NEUTRAL).
      let viaTerritory = false
      if (freshType === 'NEUTRAL' && !a.factionId && !b.factionId) {
        const homeA = deriveHomeLocation(a.id, sortedLocationNames)
        const homeB = deriveHomeLocation(b.id, sortedLocationNames)
        const unaffiliatedType = decideUnaffiliatedTie(a, b, homeA !== null && homeA === homeB)
        if (unaffiliatedType !== 'NEUTRAL') {
          freshType = unaffiliatedType
          viaTerritory = true
        }
      }
      return { type: freshType, meta: viaTerritory }
    },
    buildExpireChange: (n, _otherId, previous) => ({
      reason: `${n.name}'s ${previous.type === 'RIVAL' ? 'rivalry' : 'alliance'} lapses — the other party is no longer part of this world's active cast`,
      significant: false,
    }),
    buildNeutralChange: (a, b, previous) => ({
      reason: `${a.name} and ${b.name} are no longer ${previous.type === 'RIVAL' ? 'rivals' : 'allies'}`,
      significant: false,
    }),
    buildNewChange: (a, b, freshType, viaTerritory) => ({
      reason: viaTerritory
        ? (freshType === 'RIVAL'
            ? `${a.name} and ${b.name}, neither answering to any faction, become rivals over the same turf`
            : `${a.name} and ${b.name}, neither answering to any faction, find community sharing the same turf`)
        : a.factionId === b.factionId
          ? `${a.name} and ${b.name} stand together, serving the same cause`
          : `${a.name} and ${b.name} become ${freshType === 'RIVAL' ? 'rivals' : 'allies'} through their factions' own ${freshType === 'RIVAL' ? 'rivalry' : 'alliance'}`,
      // A new individual rivalry is worth a beat; a new same-faction/turf alliance is routine background texture.
      significant: freshType === 'RIVAL',
    }),
  })

  if (!ctx.dryRun) {
    for (const npcId of dirty) {
      await prisma.nPC.update({ where: { id: npcId }, data: { socialTies: working.get(npcId) as unknown as Prisma.InputJsonValue } })
    }
  }

  return { changes }
}

export interface JointSchemeDecision {
  shouldSpawn: boolean
  name?: string
  description?: string
  category?: string
  maxTicks?: number
  consequence?: string
}

const JOINT_SCHEME_MAX_TICKS = 6

/**
 * Pure decision: should these two allied NPCs start a joint scheme this
 * turn? Triggers when both independently-paced schedules (see
 * isActingPhase, npcTick.ts) converge on "acting" the same turn — a
 * natural, deterministic moment for cooperation, not a random roll.
 */
export function decideJointScheme(
  a: { id: string; name: string; goals: string | null },
  b: { id: string; name: string; goals: string | null },
  turnNumber: number,
  hasActiveScheme: boolean
): JointSchemeDecision {
  if (hasActiveScheme) return { shouldSpawn: false }
  if (!isActingPhase(a.id, turnNumber) || !isActingPhase(b.id, turnNumber)) return { shouldSpawn: false }

  const goalA = a.goals?.trim() || 'their own ends'
  const goalB = b.goals?.trim() || 'their own ends'
  return {
    shouldSpawn: true,
    name: `${a.name} and ${b.name} Join Forces`,
    description: `${a.name} and ${b.name}, allies, begin working together: ${goalA} alongside ${goalB}.`,
    category: 'social',
    maxTicks: JOINT_SCHEME_MAX_TICKS,
    consequence: `${a.name} and ${b.name}'s joint scheme comes together — ${goalA}, and ${goalB}, both take a real step forward.`,
  }
}

export async function tickNpcJointSchemes(ctx: TickContext): Promise<TickHandlerResult> {
  const npcs = await prisma.nPC.findMany({
    where: { campaignId: ctx.campaignId, isAlive: true, importance: { gte: MAJOR_IMPORTANCE_THRESHOLD } },
    orderBy: { importance: 'desc' },
    take: ctx.npcCap,
    select: { id: true, name: true, goals: true, socialTies: true },
  })

  const changes: WorldChange[] = []
  const npcById = new Map(npcs.map((n) => [n.id, n]))

  // Every ALLY pair on record among this turn's roster (ties were just
  // written by tickNpcSocialTies above in the same pass).
  const allyPairs: Array<[string, string]> = []
  const seen = new Set<string>()
  for (const n of npcs) {
    const ties = parseFactionRelationships(n.socialTies)
    for (const [otherId, tie] of Object.entries(ties)) {
      if (tie.type !== 'ALLY' || !npcById.has(otherId)) continue
      const key = [n.id, otherId].sort().join(':')
      if (seen.has(key)) continue
      seen.add(key)
      allyPairs.push([n.id, otherId])
    }
  }
  if (allyPairs.length === 0) return { changes }

  const activeSchemeClocks = await prisma.clock.findMany({
    where: { campaignId: ctx.campaignId, resolvedAt: null, participantNpcIds: { isEmpty: false } },
    select: { participantNpcIds: true },
  })
  const hasActiveSchemeFor = (aId: string, bId: string) =>
    activeSchemeClocks.some((c) => c.participantNpcIds.includes(aId) && c.participantNpcIds.includes(bId))

  for (const [aId, bId] of allyPairs) {
    const a = npcById.get(aId)!
    const b = npcById.get(bId)!
    const decision = decideJointScheme(a, b, ctx.turnNumber, hasActiveSchemeFor(aId, bId))
    if (!decision.shouldSpawn) continue

    if (!ctx.dryRun) {
      await prisma.clock.create({
        data: {
          campaignId: ctx.campaignId,
          name: decision.name!,
          description: decision.description!,
          category: decision.category!,
          maxTicks: decision.maxTicks!,
          consequence: decision.consequence!,
          participantNpcIds: [aId, bId],
        },
      })
    }

    changes.push({
      entityType: 'NPC', entityId: aId, entityName: a.name, campaignId: ctx.campaignId,
      field: 'jointScheme', previousValue: '(none)', newValue: decision.name!,
      reason: decision.description!,
      significant: true, importance: 'NORMAL',
    })
  }

  return { changes }
}
