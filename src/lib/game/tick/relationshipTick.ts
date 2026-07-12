// src/lib/game/tick/relationshipTick.ts
// World Sim Phase 3 — factions form rivalries and alliances with each other
// based on their goals, instead of every faction acting in isolation. This
// is what makes DESTABILIZE_RIVAL a reachable goal (see
// decideFactionGoalReassessment in factionTick.ts) instead of an orphaned
// GM-only setting: a faction can only move against "a rival" once the
// simulation actually knows who that is.
//
// Deliberately scoped to RIVAL and ALLY only — a "cold" relationship layer.
// Open war is not decided here: that's warTick.ts's job (the sustained
// multi-turn War object, Phase 5), which READS these relationships — a war
// can only ignite between factions on record as RIVALs, and a war coalition
// only grows through factions on record as ALLYs. A rivalry here is
// friction and competition; warTick decides when it becomes open conflict.
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
import { FactionRelationshipEntry, TickContext, TickHandlerResult, WorldChange, parseFactionRelationships } from './types'

export type RelationshipType = 'RIVAL' | 'ALLY' | 'NEUTRAL'

// The entry shape itself lives in types.ts (see the note there about
// import cycles); re-exported here for existing importers.
export type { FactionRelationshipEntry }

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

  // Full campaign roster (uncapped, defunct included) for two jobs below:
  // knowing which relationship entries point at factions that no longer
  // exist as independent actors, and naming them in the change reason.
  const allFactions = await prisma.faction.findMany({
    where: { campaignId: ctx.campaignId },
    select: { id: true, name: true, isActive: true },
  })
  const activeFactionIds = new Set(allFactions.filter((f) => f.isActive).map((f) => f.id))
  const factionNameById = new Map(allFactions.map((f) => [f.id, f.name]))

  const changes: WorldChange[] = []

  // One mutable working copy per faction, written back once at the end.
  // The naive alternative — re-spreading faction.relationships fresh for
  // each pair and writing immediately — silently clobbers earlier same-tick
  // updates when one faction's relationships change against two or more
  // partners in the same pass (the later spread of the stale fetched object
  // doesn't contain the earlier pair's write).
  const working = new Map<string, Record<string, FactionRelationshipEntry>>()
  const dirty = new Set<string>()
  for (const f of factions) {
    working.set(f.id, { ...parseFactionRelationships(f.relationships) })
  }

  // Expire relationships whose other side has collapsed or been deleted —
  // nothing else ever removes these entries (this handler only ever
  // iterates active pairs), so without this a faction whose only rival
  // collapsed stays "rivaled" forever, permanently skewing goal
  // reassessment toward DESTABILIZE_RIVAL.
  for (const f of factions) {
    const rels = working.get(f.id)!
    for (const [otherId, rel] of Object.entries(rels)) {
      if (activeFactionIds.has(otherId)) continue
      delete rels[otherId]
      dirty.add(f.id)
      changes.push({
        entityType: 'FACTION',
        entityId: f.id,
        entityName: f.name,
        campaignId: ctx.campaignId,
        field: 'relationship',
        previousValue: rel.type,
        newValue: 'NEUTRAL',
        reason: `${f.name}'s ${rel.type === 'RIVAL' ? 'rivalry' : 'alliance'} with ${factionNameById.get(otherId) || 'a defunct faction'} lapses — the other side no longer exists as an independent faction`,
        significant: true,
        importance: 'NORMAL',
      })
    }
  }

  for (let i = 0; i < factions.length; i++) {
    for (let j = i + 1; j < factions.length; j++) {
      const a = factions[i]
      const b = factions[j]

      const freshType = decideRelationshipTick(a, b)
      const aRelationships = working.get(a.id)!
      const bRelationships = working.get(b.id)!
      const existing = aRelationships[b.id]

      if (freshType === 'NEUTRAL') {
        if (!existing) continue

        delete aRelationships[b.id]
        delete bRelationships[a.id]
        dirty.add(a.id)
        dirty.add(b.id)

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
      dirty.add(a.id)
      dirty.add(b.id)

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

  if (!ctx.dryRun) {
    for (const factionId of dirty) {
      await prisma.faction.update({
        where: { id: factionId },
        data: { relationships: working.get(factionId) as any },
      })
    }
  }

  return { changes }
}
