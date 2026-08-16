// src/lib/game/tick/relationshipEngine.ts
//
// Shared engine behind the two tick handlers that track a symmetric RIVAL/
// ALLY/NEUTRAL tie between pairs of entities: relationshipTick.ts (factions)
// and npcSocietyTick.ts (NPC social ties). Both used to independently
// implement the exact same shape — seed a mutable working copy of each
// entity's tie map, expire entries whose other side dropped out of this
// tick's active roster, then walk every pair deciding whether the tie
// changed — differing only in how a pair's tie is decided and how the
// resulting WorldChange is worded. This is that shape, factored out once.
//
// #373: the engine now speaks in EDGES rather than in per-entity JSON
// blobs. Two things that used to be the engine's job stopped being
// anybody's job:
//
//   - Writing both sides. The old code set `aTies[b.id]` and `bTies[a.id]`
//     and was the ONLY writer that did, which is why asymmetry needed an
//     integrity check. One canonical row per pair cannot be asymmetric.
//
//   - The mutable working copy. It existed because re-spreading each
//     entity's fetched map per pair clobbered earlier same-tick updates
//     when one entity's ties changed against two partners in one pass.
//     With edges there is nothing to clobber — each pair is its own row.
//
// Persistence is still deliberately NOT done here: the two callers write to
// different Prisma models (FactionTie vs NpcTie) with differently-named
// endpoint columns, so each keeps its own dryRun-gated persistence loop
// over the `upserts`/`deletes` this returns.

import { TickEntityType, WorldChange } from './types'
import { TieEdge, TieType as GraphTieType, canonicalTie, indexTies, pairKey, tiesOf } from '../tieGraph'

export type TieType = GraphTieType | 'NEUTRAL'

export interface TieChangeText {
  reason: string
  significant: boolean
}

/** A pair to remove, canonically ordered. */
export interface TieDeletion {
  aId: string
  bId: string
}

export interface PairwiseTiesResult {
  changes: WorldChange[]
  /** Edges to create or update, canonically ordered (aId < bId). */
  upserts: TieEdge[]
  /** Pairs whose tie ended — expired or gone NEUTRAL. */
  deletes: TieDeletion[]
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
  /** Every tie on record that touches at least one of `entities`. */
  existingEdges: TieEdge[]
  /** Whether `otherId` is still part of this tick's active roster — an edge pointing at anything else expires. */
  isValidOtherId: (otherId: string) => boolean
  decide: (a: E, b: E) => { type: TieType; meta: M }
  buildExpireChange: (entity: E, otherId: string, previous: { type: GraphTieType }) => TieChangeText
  buildNeutralChange: (a: E, b: E, previous: { type: GraphTieType }) => TieChangeText
  buildNewChange: (a: E, b: E, type: GraphTieType, meta: M) => TieChangeText
}): PairwiseTiesResult {
  const { campaignId, entityType, entities, turnNumber, existingEdges, isValidOtherId, decide, buildExpireChange, buildNeutralChange, buildNewChange } = params

  const changes: WorldChange[] = []
  const upserts: TieEdge[] = []
  const deletes: TieDeletion[] = []
  const index = indexTies(existingEdges)

  // Expire ties whose other side dropped out of this tick's active roster
  // (collapsed, died, deleted) — nothing else ever removes these, so
  // without this an edge to a since-gone counterpart stays on record
  // forever. Driven from `entities` rather than from `existingEdges` so an
  // edge between two entities BOTH outside the roster is left alone: this
  // tick has no opinion about a pair it is not simulating.
  const expired = new Set<string>()
  for (const e of entities) {
    for (const [otherId, tie] of Object.entries(tiesOf(index, e.id))) {
      if (isValidOtherId(otherId)) continue
      const key = pairKey(e.id, otherId)
      if (expired.has(key)) continue
      expired.add(key)

      const pair = canonicalTie(e.id, otherId, tie.type, tie.since)
      if (pair) deletes.push({ aId: pair.aId, bId: pair.bId })

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
      const existing = tiesOf(index, a.id)[b.id]

      if (freshType === 'NEUTRAL') {
        if (!existing) continue

        const pair = canonicalTie(a.id, b.id, existing.type, existing.since)
        if (pair) deletes.push({ aId: pair.aId, bId: pair.bId })

        const { reason, significant } = buildNeutralChange(a, b, existing)
        changes.push({
          entityType, entityId: a.id, entityName: a.name, campaignId,
          field: 'relationship', previousValue: existing.type, newValue: 'NEUTRAL',
          reason, significant, importance: 'NORMAL',
        })
        continue
      }

      if (existing?.type === freshType) continue

      const edge = canonicalTie(a.id, b.id, freshType, turnNumber)
      if (edge) upserts.push(edge)

      const { reason, significant } = buildNewChange(a, b, freshType, meta)
      changes.push({
        entityType, entityId: a.id, entityName: a.name, campaignId,
        field: 'relationship', previousValue: existing?.type || 'NEUTRAL', newValue: freshType,
        reason, significant, importance: 'NORMAL',
      })
    }
  }

  return { changes, upserts, deletes }
}
