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
// Known scope boundary: ties only form between NPCs who have a faction
// affiliation. An unaffiliated major NPC (a lone wolf, an independent
// operator) gets no derived social ties in this pass — see the README.
//
// Runs immediately after tickNpcs in the handler order (worldTick.ts):
// joint schemes read the ties this file just wrote in the same pass (no
// lag needed — unlike relationshipTick/factionTick, this isn't a circular
// dependency, just ties-then-consequences).

import { prisma } from '@/lib/prisma'
import { TickContext, TickHandlerResult, WorldChange, FactionRelationshipEntry, parseFactionRelationships } from './types'
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

export async function tickNpcSocialTies(ctx: TickContext): Promise<TickHandlerResult> {
  const npcs = await prisma.nPC.findMany({
    where: { campaignId: ctx.campaignId, isAlive: true, importance: { gte: MAJOR_IMPORTANCE_THRESHOLD } },
    orderBy: { importance: 'desc' },
    take: ctx.npcCap,
    select: { id: true, name: true, factionId: true, socialTies: true },
  })

  const factionIds = [...new Set(npcs.map((n) => n.factionId).filter((id): id is string => !!id))]
  const factions = factionIds.length > 0
    ? await prisma.faction.findMany({ where: { id: { in: factionIds } }, select: { id: true, relationships: true } })
    : []
  const factionRelById = new Map(factions.map((f) => [f.id, parseFactionRelationships(f.relationships)]))

  const factionRelationshipBetween = (aFactionId: string, bFactionId: string): 'RIVAL' | 'ALLY' | 'NEUTRAL' => {
    if (aFactionId === bFactionId) return 'NEUTRAL' // same-faction case handled separately by decideNpcSocialTie
    return factionRelById.get(aFactionId)?.[bFactionId]?.type ?? 'NEUTRAL'
  }

  const changes: WorldChange[] = []
  const aliveNpcIds = new Set(npcs.map((n) => n.id))
  const working = new Map<string, Record<string, FactionRelationshipEntry>>()
  const dirty = new Set<string>()
  for (const n of npcs) {
    working.set(n.id, { ...parseFactionRelationships(n.socialTies) })
  }

  // Expire ties whose other NPC died, dropped below major importance, or
  // was otherwise removed from this tick's roster — without this a tie
  // to a dead NPC stays on record forever, since nothing else ever visits it.
  for (const n of npcs) {
    const ties = working.get(n.id)!
    for (const [otherId, tie] of Object.entries(ties)) {
      if (aliveNpcIds.has(otherId)) continue
      delete ties[otherId]
      dirty.add(n.id)
      changes.push({
        entityType: 'NPC', entityId: n.id, entityName: n.name, campaignId: ctx.campaignId,
        field: 'socialTie', previousValue: tie.type, newValue: 'NEUTRAL',
        reason: `${n.name}'s ${tie.type === 'RIVAL' ? 'rivalry' : 'alliance'} lapses — the other party is no longer part of this world's active cast`,
        significant: false, importance: 'NORMAL',
      })
    }
  }

  for (let i = 0; i < npcs.length; i++) {
    for (let j = i + 1; j < npcs.length; j++) {
      const a = npcs[i]
      const b = npcs[j]
      const factionRel = a.factionId && b.factionId ? factionRelationshipBetween(a.factionId, b.factionId) : 'NEUTRAL'
      const freshType = decideNpcSocialTie(a, b, factionRel)

      const aTies = working.get(a.id)!
      const bTies = working.get(b.id)!
      const existing = aTies[b.id]

      if (freshType === 'NEUTRAL') {
        if (!existing) continue
        delete aTies[b.id]
        delete bTies[a.id]
        dirty.add(a.id)
        dirty.add(b.id)
        changes.push({
          entityType: 'NPC', entityId: a.id, entityName: a.name, campaignId: ctx.campaignId,
          field: 'socialTie', previousValue: existing.type, newValue: 'NEUTRAL',
          reason: `${a.name} and ${b.name} are no longer ${existing.type === 'RIVAL' ? 'rivals' : 'allies'}`,
          significant: false, importance: 'NORMAL',
        })
        continue
      }

      if (existing?.type === freshType) continue

      aTies[b.id] = { type: freshType, since: ctx.turnNumber }
      bTies[a.id] = { type: freshType, since: ctx.turnNumber }
      dirty.add(a.id)
      dirty.add(b.id)

      changes.push({
        entityType: 'NPC', entityId: a.id, entityName: a.name, campaignId: ctx.campaignId,
        field: 'socialTie', previousValue: existing?.type || 'NEUTRAL', newValue: freshType,
        reason: a.factionId === b.factionId
          ? `${a.name} and ${b.name} stand together, serving the same cause`
          : `${a.name} and ${b.name} become ${freshType === 'RIVAL' ? 'rivals' : 'allies'} through their factions' own ${freshType === 'RIVAL' ? 'rivalry' : 'alliance'}`,
        significant: freshType === 'RIVAL', // a new individual rivalry is worth a beat; a new same-faction alliance is routine background texture
        importance: 'NORMAL',
      })
    }
  }

  if (!ctx.dryRun) {
    for (const npcId of dirty) {
      await prisma.nPC.update({ where: { id: npcId }, data: { socialTies: working.get(npcId) as any } })
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
