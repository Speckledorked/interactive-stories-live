// src/lib/game/tick/relationshipEngine.ts
//
// Shared engine behind the two tick handlers that track a symmetric RIVAL/
// ALLY/NEUTRAL tie between pairs of entities: relationshipTick.ts (factions)
// and npcSocietyTick.ts (NPC social ties). Both used to independently
// implement the exact same shape — seed a mutable working copy of each
// entity's JSON tie map, expire entries whose other side dropped out of this
// tick's active roster, then walk every pair deciding whether the tie
// changed — differing only in how a pair's tie is decided and how the
// resulting WorldChange is worded. This is that shape, factored out once.
//
// Persistence is deliberately NOT done here: the two callers write to
// different Prisma models (Faction vs NPC) and different columns
// (relationships vs socialTies), so each keeps its own dryRun-gated
// persistence loop over the `dirty`/`working` this returns.

import { FactionRelationshipEntry, TickEntityType, WorldChange, parseFactionRelationships } from './types'

export type TieType = 'RIVAL' | 'ALLY' | 'NEUTRAL'

export interface TieChangeText {
  reason: string
  significant: boolean
}

export interface PairwiseTiesResult {
  changes: WorldChange[]
  working: Map<string, Record<string, FactionRelationshipEntry>>
  dirty: Set<string>
}

/**
 * Run one tick's worth of pairwise tie decisions over `entities`.
 *
 * `meta` lets a caller's `decide` carry extra context its `buildNewChange`
 * needs for wording (e.g. npcSocietyTick's "was this tie decided via shared
 * territory, not faction politics?") without the engine needing to know
 * what that context means.
 */
export function tickPairwiseTies<E extends { id: string; name: string }, M = undefined>(params: {
  campaignId: string
  entityType: TickEntityType
  entities: E[]
  turnNumber: number
  getRawTies: (entity: E) => unknown
  /** Whether `otherId` is still part of this tick's active roster — an entry pointing at anything else expires. */
  isValidOtherId: (otherId: string) => boolean
  decide: (a: E, b: E) => { type: TieType; meta: M }
  buildExpireChange: (entity: E, otherId: string, previous: FactionRelationshipEntry) => TieChangeText
  buildNeutralChange: (a: E, b: E, previous: FactionRelationshipEntry) => TieChangeText
  buildNewChange: (a: E, b: E, type: 'RIVAL' | 'ALLY', meta: M) => TieChangeText
}): PairwiseTiesResult {
  const { campaignId, entityType, entities, turnNumber, getRawTies, isValidOtherId, decide, buildExpireChange, buildNeutralChange, buildNewChange } = params

  const changes: WorldChange[] = []

  // One mutable working copy per entity, written back once at the end by
  // the caller. The naive alternative — re-spreading the fetched ties fresh
  // for each pair and writing immediately — silently clobbers earlier
  // same-tick updates when one entity's ties change against two or more
  // partners in the same pass.
  const working = new Map<string, Record<string, FactionRelationshipEntry>>()
  const dirty = new Set<string>()
  for (const e of entities) {
    working.set(e.id, { ...parseFactionRelationships(getRawTies(e)) })
  }

  // Expire ties whose other side dropped out of this tick's active roster
  // (collapsed, died, deleted) — nothing else ever removes these entries,
  // so without this an entry to a since-gone counterpart stays on record
  // forever.
  for (const e of entities) {
    const ties = working.get(e.id)!
    for (const [otherId, tie] of Object.entries(ties)) {
      if (isValidOtherId(otherId)) continue
      delete ties[otherId]
      dirty.add(e.id)
      const { reason, significant } = buildExpireChange(e, otherId, tie)
      changes.push({
        entityType, entityId: e.id, entityName: e.name, campaignId,
        field: 'relationship', previousValue: tie.type, newValue: 'NEUTRAL',
        reason, significant, importance: 'NORMAL',
      })
    }
  }

  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      const a = entities[i]
      const b = entities[j]

      const { type: freshType, meta } = decide(a, b)
      const aTies = working.get(a.id)!
      const bTies = working.get(b.id)!
      const existing = aTies[b.id]

      if (freshType === 'NEUTRAL') {
        if (!existing) continue

        delete aTies[b.id]
        delete bTies[a.id]
        dirty.add(a.id)
        dirty.add(b.id)

        const { reason, significant } = buildNeutralChange(a, b, existing)
        changes.push({
          entityType, entityId: a.id, entityName: a.name, campaignId,
          field: 'relationship', previousValue: existing.type, newValue: 'NEUTRAL',
          reason, significant, importance: 'NORMAL',
        })
        continue
      }

      if (existing?.type === freshType) continue

      aTies[b.id] = { type: freshType, since: turnNumber }
      bTies[a.id] = { type: freshType, since: turnNumber }
      dirty.add(a.id)
      dirty.add(b.id)

      const { reason, significant } = buildNewChange(a, b, freshType, meta)
      changes.push({
        entityType, entityId: a.id, entityName: a.name, campaignId,
        field: 'relationship', previousValue: existing?.type || 'NEUTRAL', newValue: freshType,
        reason, significant, importance: 'NORMAL',
      })
    }
  }

  return { changes, working, dirty }
}
