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

import type { FactionGoal } from '@prisma/client'
import { band } from './factionTick'
import { FactionRelationshipEntry, TickContext, TickHandlerResult } from './types'
import { tickPairwiseTies } from './relationshipEngine'
import { rosterFactionFilter } from './capOrdering'
import { edgesFromFactionRows } from '../tieGraph'

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
  const factions = await ctx.db.faction.findMany({
    // #375: this tick's roster, resolved once in worldTick.ts — never a
    // per-handler capped/rotated query. See capOrdering.ts.
    where: { campaignId: ctx.campaignId, isActive: true, ...rosterFactionFilter(ctx) },
  })

  // Full campaign roster (uncapped, defunct included) for two jobs below:
  // knowing which relationship entries point at factions that no longer
  // exist as independent actors, and naming them in the change reason.
  const allFactions = await ctx.db.faction.findMany({
    where: { campaignId: ctx.campaignId },
    select: { id: true, name: true, isActive: true },
  })
  const activeFactionIds = new Set(allFactions.filter((f) => f.isActive).map((f) => f.id))
  const factionNameById = new Map(allFactions.map((f) => [f.id, f.name]))

  // #373: every tie on record for this campaign, as edges. Campaign-scoped
  // rather than restricted to this tick's roster because the expire pass
  // needs to see an edge pointing OUT of the roster in order to end it.
  const existingRows = await ctx.db.factionTie.findMany({
    where: { campaignId: ctx.campaignId },
    select: { factionAId: true, factionBId: true, type: true, since: true },
  })

  const { changes, upserts, deletes } = tickPairwiseTies({
    campaignId: ctx.campaignId,
    entityType: 'FACTION',
    entities: factions,
    turnNumber: ctx.turnNumber,
    existingEdges: edgesFromFactionRows(existingRows),
    // A rival only counts if it still exists as an active faction —
    // nothing else ever expires a stale entry (see the module doc above).
    isValidOtherId: (otherId) => activeFactionIds.has(otherId),
    decide: (a, b) => ({ type: decideRelationshipTick(a, b), meta: undefined }),
    buildExpireChange: (f, otherId, previous) => ({
      reason: `${f.name}'s ${previous.type === 'RIVAL' ? 'rivalry' : 'alliance'} with ${factionNameById.get(otherId) || 'a defunct faction'} lapses — the other side no longer exists as an independent faction`,
      significant: true,
    }),
    buildNeutralChange: (a, b, previous) => ({
      reason: `${a.name} and ${b.name} are no longer ${previous.type === 'RIVAL' ? 'rivals' : 'allies'}`,
      significant: true,
    }),
    buildNewChange: (a, b, freshType) => ({
      reason: `${a.name} and ${b.name} become ${freshType === 'RIVAL' ? 'rivals' : 'allies'}, both pursuing ${a.goal === b.goal ? a.goal : `${a.goal}/${b.goal}`}`,
      significant: true,
    }),
  })

  if (!ctx.dryRun) {
    // Deletes first: a pair can only appear in one list per tick, but
    // ordering them this way keeps the write pass total rather than
    // order-dependent if that ever stops being true.
    for (const pair of deletes) {
      await ctx.db.factionTie.deleteMany({
        where: { factionAId: pair.aId, factionBId: pair.bId },
      })
    }
    for (const edge of upserts) {
      await ctx.db.factionTie.upsert({
        where: { factionAId_factionBId: { factionAId: edge.aId, factionBId: edge.bId } },
        // A tie flipping RIVAL <-> ALLY is a NEW tie, so `since` resets —
        // matching the old behaviour, where the writer overwrote the whole
        // entry with the current turn number.
        update: { type: edge.type, since: edge.since },
        create: {
          campaignId: ctx.campaignId,
          factionAId: edge.aId,
          factionBId: edge.bId,
          type: edge.type,
          since: edge.since,
        },
      })
    }
  }

  return { changes }
}
