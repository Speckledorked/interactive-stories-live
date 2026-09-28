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
import { BeliefVector, parseBeliefVector } from './beliefTick'

export type RelationshipType = 'RIVAL' | 'ALLY' | 'NEUTRAL'

// The entry shape itself lives in types.ts (see the note there about
// import cycles); re-exported here for existing importers.
export type { FactionRelationshipEntry }

/**
 * Why a RIVAL tie was pinned rather than decided from goals — threaded
 * through the engine's `meta` so the change reason can say so.
 */
export type RivalryPin = 'war' | 'belief'

/**
 * Two factions count as ideological enemies when their belief vectors are
 * this far apart on ANY single axis (0-100 scale, neutral 50). 40 means one
 * side sits near an extreme the other rejects — e.g. aggression 90 vs 50 —
 * not a mild disagreement. Belief drift moves ~4 per event (beliefTick),
 * so crossing this takes sustained divergence, not one bad turn.
 */
export const BELIEF_RIVALRY_DISTANCE = 40

function maxBeliefDistance(a: BeliefVector, b: BeliefVector): number {
  return Math.max(
    Math.abs(a.aggression - b.aggression),
    Math.abs(a.isolationism - b.isolationism),
    Math.abs(a.mercantilism - b.mercantilism),
    Math.abs(a.zealotry - b.zealotry)
  )
}

/** Pure decision function — no DB access, safe to unit test directly. */
export function decideRelationshipTick(
  a: { goal: FactionGoal; stability: number },
  b: { goal: FactionGoal; stability: number },
  opts?: { atWar?: boolean; beliefA?: BeliefVector | null; beliefB?: BeliefVector | null }
): { type: RelationshipType; pin?: RivalryPin } {
  // Blood outlasts paperwork: a pair actively shooting at each other stays
  // RIVAL no matter what the goal labels say this tick. Without the pin, a
  // war pair whose goals drift goes NEUTRAL mid-war and warTick loses the
  // RIVAL precondition its declarations and coalitions depend on.
  if (opts?.atWar) return { type: 'RIVAL', pin: 'war' }
  // Ideological distance past the threshold is enmity even without
  // competing goals — beliefs start driving diplomacy instead of just
  // decorating it. Null (never drifted) skips this check entirely, so only
  // real divergence counts; the goal/stability rules below stay the legacy
  // behavior for belief-less pairs.
  const { beliefA, beliefB } = opts ?? {}
  if (beliefA && beliefB && maxBeliefDistance(beliefA, beliefB) >= BELIEF_RIVALRY_DISTANCE) {
    return { type: 'RIVAL', pin: 'belief' }
  }
  // Two factions chasing the same finite thing (territory, wealth) are
  // natural competitors.
  if (a.goal === b.goal && (a.goal === 'EXPAND' || a.goal === 'ENRICH')) {
    return { type: 'RIVAL' }
  }
  // Two factions that are both stable and both looking inward aren't
  // stepping on each other's toes — a natural non-aggression pact.
  const bothInward = (a.goal === 'DEFEND' || a.goal === 'CONSOLIDATE') && (b.goal === 'DEFEND' || b.goal === 'CONSOLIDATE')
  if (bothInward && band(a.stability) !== 'LOW' && band(b.stability) !== 'LOW') {
    return { type: 'ALLY' }
  }
  return { type: 'NEUTRAL' }
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

  // Wars pin rivalries: any pair with an ESCALATING war between them is
  // RIVAL this tick regardless of goals (see decideRelationshipTick).
  // Participants included so coalition joiners pin too, not just the two
  // declarants. One batched read for the whole pairwise pass.
  const escalatingWars = await ctx.db.war.findMany({
    where: { campaignId: ctx.campaignId, status: 'ESCALATING' },
    select: {
      attackerFactionId: true,
      defenderFactionId: true,
      participants: { select: { factionId: true, side: true } },
    },
  })
  const pairKey = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`)
  const warPairKeys = new Set<string>()
  for (const w of escalatingWars) {
    const attackers = new Set([
      w.attackerFactionId,
      ...w.participants.filter((p) => p.side === 'ATTACKER').map((p) => p.factionId),
    ])
    const defenders = new Set([
      w.defenderFactionId,
      ...w.participants.filter((p) => p.side === 'DEFENDER').map((p) => p.factionId),
    ])
    for (const a of attackers) for (const d of defenders) warPairKeys.add(pairKey(a, d))
  }

  const { changes, upserts, deletes } = tickPairwiseTies({
    campaignId: ctx.campaignId,
    entityType: 'FACTION',
    entities: factions,
    turnNumber: ctx.turnNumber,
    existingEdges: edgesFromFactionRows(existingRows),
    // A rival only counts if it still exists as an active faction —
    // nothing else ever expires a stale entry (see the module doc above).
    isValidOtherId: (otherId) => activeFactionIds.has(otherId),
    decide: (a, b) => {
      const { type, pin } = decideRelationshipTick(a, b, {
        atWar: warPairKeys.has(pairKey(a.id, b.id)),
        beliefA: parseBeliefVector(a.beliefVector),
        beliefB: parseBeliefVector(b.beliefVector),
      })
      return { type, meta: pin }
    },
    buildExpireChange: (f, otherId, previous) => ({
      reason: `${f.name}'s ${previous.type === 'RIVAL' ? 'rivalry' : 'alliance'} with ${factionNameById.get(otherId) || 'a defunct faction'} lapses — the other side no longer exists as an independent faction`,
      significant: true,
    }),
    buildNeutralChange: (a, b, previous) => ({
      reason: `${a.name} and ${b.name} are no longer ${previous.type === 'RIVAL' ? 'rivals' : 'allies'}`,
      significant: true,
    }),
    buildNewChange: (a, b, freshType, meta) => {
      const reason =
        meta === 'war'
          ? `${a.name} and ${b.name} are locked as rivals — the war between them pins the enmity regardless of shifting goals`
          : meta === 'belief'
            ? `${a.name} and ${b.name} become rivals — their beliefs have drifted too far apart`
            : `${a.name} and ${b.name} become ${freshType === 'RIVAL' ? 'rivals' : 'allies'}, both pursuing ${a.goal === b.goal ? a.goal : `${a.goal}/${b.goal}`}`
      return { reason, significant: true }
    },
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
