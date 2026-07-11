// src/lib/game/tick/relationshipTick.ts
// World Sim Phase 3 — factions form rivalries and alliances with each other
// based on their goals, instead of every faction acting in isolation. This
// is what makes DESTABILIZE_RIVAL a reachable goal (see
// decideFactionGoalReassessment in factionTick.ts) instead of an orphaned
// GM-only setting: a faction can only move against "a rival" once the
// simulation actually knows who that is.
//
// Deliberately scoped to RIVAL and ALLY only — a "cold" relationship layer.
// AT_WAR is not decided here: declaring and resolving an actual war needs a
// sustained, multi-turn conflict object that doesn't exist yet (see the
// README roadmap, Phase 5). Until then, a rivalry is friction and
// competition, not open conflict.
//
// Runs BEFORE tickFactions in the handler order (see worldTick.ts) so it
// reads each faction's goal as of the end of the previous turn, and
// tickFactions can then read the freshly-written relationship for this same
// turn's goal reassessment. That one-tick lag avoids a same-turn circular
// dependency (relationships depend on goals; DESTABILIZE_RIVAL depends on
// relationships) without needing a two-pass tick.

import { prisma } from '@/lib/prisma'
import type { FactionGoal } from '@prisma/client'
import { band } from './factionTick'
import { TickContext, TickHandlerResult, WorldChange } from './types'

export type RelationshipType = 'RIVAL' | 'ALLY' | 'NEUTRAL'

export interface FactionRelationshipEntry {
  type: 'RIVAL' | 'ALLY'
  since: number
}

/** Pure decision function — no DB access, safe to unit test directly. */
export function decideRelationshipTick(
  a: { goal: FactionGoal; stability: number },
  b: { goal: FactionGoal; stability: number }
): RelationshipType {
  // Two factions chasing the same finite thing (territory, wealth) are
  // natural competitors.
  if (a.goal === b.goal && (a.goal === 'EXPAND' || a.goal === 'ENRICH')) {
    return 'RIVAL'
  }
  // Two factions that are both stable and both looking inward aren't
  // stepping on each other's toes — a natural non-aggression pact.
  const bothInward = (a.goal === 'DEFEND' || a.goal === 'CONSOLIDATE') && (b.goal === 'DEFEND' || b.goal === 'CONSOLIDATE')
  if (bothInward && band(a.stability) !== 'LOW' && band(b.stability) !== 'LOW') {
    return 'ALLY'
  }
  return 'NEUTRAL'
}

export async function tickFactionRelationships(ctx: TickContext): Promise<TickHandlerResult> {
  const factions = await prisma.faction.findMany({
    where: { campaignId: ctx.campaignId, isActive: true },
    orderBy: { createdAt: 'asc' },
    take: ctx.factionCap,
  })

  const changes: WorldChange[] = []

  for (let i = 0; i < factions.length; i++) {
    for (let j = i + 1; j < factions.length; j++) {
      const a = factions[i]
      const b = factions[j]

      const freshType = decideRelationshipTick(a, b)
      const aRelationships = { ...((a.relationships as any as Record<string, FactionRelationshipEntry>) || {}) }
      const bRelationships = { ...((b.relationships as any as Record<string, FactionRelationshipEntry>) || {}) }
      const existing = aRelationships[b.id]

      if (freshType === 'NEUTRAL') {
        if (!existing) continue

        delete aRelationships[b.id]
        delete bRelationships[a.id]
        if (!ctx.dryRun) {
          await prisma.faction.update({ where: { id: a.id }, data: { relationships: aRelationships as any } })
          await prisma.faction.update({ where: { id: b.id }, data: { relationships: bRelationships as any } })
        }

        changes.push({
          entityType: 'FACTION',
          entityId: a.id,
          entityName: a.name,
          campaignId: ctx.campaignId,
          field: 'relationship',
          previousValue: existing.type,
          newValue: 'NEUTRAL',
          reason: `${a.name} and ${b.name} are no longer ${existing.type === 'RIVAL' ? 'rivals' : 'allies'}`,
          significant: true,
          importance: 'NORMAL',
        })
        continue
      }

      if (existing?.type === freshType) continue

      aRelationships[b.id] = { type: freshType, since: ctx.turnNumber }
      bRelationships[a.id] = { type: freshType, since: ctx.turnNumber }
      if (!ctx.dryRun) {
        await prisma.faction.update({ where: { id: a.id }, data: { relationships: aRelationships as any } })
        await prisma.faction.update({ where: { id: b.id }, data: { relationships: bRelationships as any } })
      }

      changes.push({
        entityType: 'FACTION',
        entityId: a.id,
        entityName: a.name,
        campaignId: ctx.campaignId,
        field: 'relationship',
        previousValue: existing?.type || 'NEUTRAL',
        newValue: freshType,
        reason: `${a.name} and ${b.name} become ${freshType === 'RIVAL' ? 'rivals' : 'allies'}, both pursuing ${a.goal === b.goal ? a.goal : `${a.goal}/${b.goal}`}`,
        significant: true,
        importance: 'NORMAL',
      })
    }
  }

  return { changes }
}

/** Does this faction currently have any rival, per its stored relationships? */
export function hasRival(relationships: unknown): boolean {
  if (!relationships || typeof relationships !== 'object') return false
  return Object.values(relationships as Record<string, FactionRelationshipEntry>).some((r) => r.type === 'RIVAL')
}
