// src/lib/game/tick/beliefTick.ts
// World Sim #104 — cultural drift / belief evolution.
//
// Faction has goal/archetype/currentPlan but nothing tracking how its
// outward disposition shifts based on what's actually happened to it — a
// faction that's lost two wars behaves identically to one that's won
// three. This adds a small, closed 4-axis belief vector that drifts from
// the faction's own recent WorldEvent history and, once it drifts far
// enough from neutral, becomes a real input into decideFactionGoalReassessment
// (factionTick.ts) alongside stability/resources/military.
//
// Reads a bounded window of RECENT events, not full history — "recent
// events," not "everything that ever happened."
//
// #375: that window is per-faction, spanning (Faction.beliefDriftThroughTurn,
// targetTurn]. It used to be exactly one turn, on the theory that an event
// is eligible only on the turn right after it happened and therefore needs
// no "already processed" marker. That reasoning breaks against a CAPPED,
// ROTATING roster: a faction that lost this tick's rotation was never
// looked at on the one turn its events were eligible, and the
// campaign-level watermark then advanced past that turn on its behalf — so
// its drift was discarded permanently. Each faction now carries its own
// high-water mark and catches up on every turn it missed.
//
// Scope note on war attribution: warTick.ts's 'faction.warResolved' event is
// only ever logged against the ATTACKER's faction id (see warTick.ts's
// resolveWarProgress) — there is no separate defender-side row. So a
// defending faction that wins or loses a war gets no belief drift from that
// specific event today; only the attacker does. Extending this to the
// defender would mean querying War/WarParticipant directly rather than
// WorldEvent alone, which is out of scope for this pass — documented here
// rather than silently narrowed.

import { TickContext, TickHandlerResult, WorldChange, clamp } from './types'
import { rosterFactionFilter } from './capOrdering'

export interface BeliefVector {
  aggression: number
  isolationism: number
  mercantilism: number
  zealotry: number
}

const BELIEF_AXES: (keyof BeliefVector)[] = ['aggression', 'isolationism', 'mercantilism', 'zealotry']

// Neutral starting point every axis drifts away from — matches this
// codebase's general "50 is the unremarkable middle of a 0-100 band"
// convention (Faction.stability/resources/military all default to 50 too).
export const NEUTRAL_BELIEF: BeliefVector = { aggression: 50, isolationism: 50, mercantilism: 50, zealotry: 50 }

/**
 * Parse the Json column into a usable belief vector, or null if
 * absent/malformed — same validate-on-read, drop-anything-malformed
 * convention as parseCorruptionTheme (game/corruption.ts) and
 * parseWorldRules (game/integrity/worldRules.ts). Callers fall back to
 * NEUTRAL_BELIEF rather than treating null as zero.
 */
export function parseBeliefVector(raw: unknown): BeliefVector | null {
  if (!raw || typeof raw !== 'object') return null
  const v = raw as Record<string, unknown>
  for (const axis of BELIEF_AXES) {
    if (typeof v[axis] !== 'number' || !Number.isFinite(v[axis])) return null
  }
  return {
    aggression: clamp(v.aggression as number, 0, 100),
    isolationism: clamp(v.isolationism as number, 0, 100),
    mercantilism: clamp(v.mercantilism as number, 0, 100),
    zealotry: clamp(v.zealotry as number, 0, 100),
  }
}

export type BeliefDriftEventKind = 'WAR_WON' | 'WAR_LOST' | 'COLLAPSE_RIPPLE_SURVIVED' | 'AMBITION_SUCCEEDED' | 'AMBITION_FAILED'

export interface BeliefDriftEvent {
  kind: BeliefDriftEventKind
}

// Small, bounded per-event nudge — same rough scale as other tick deltas
// (locationConditionTick's CONTEST_STRAIN=2, seasonTick's resourceRegenDelta
// range) rather than a swing large enough to flip a faction's disposition
// from one or two events.
const DRIFT_AMOUNT = 4

/**
 * Pure — no DB access. Folds a batch of this faction's own recent events
 * into its current belief vector, one small nudge per event, each axis
 * independently clamped to 0-100.
 */
export function decideBeliefDrift(current: BeliefVector, recentEvents: BeliefDriftEvent[]): BeliefVector {
  let next = { ...current }
  for (const event of recentEvents) {
    switch (event.kind) {
      // A won war emboldens; a lost one breeds caution and withdrawal.
      case 'WAR_WON':
        next = { ...next, aggression: clamp(next.aggression + DRIFT_AMOUNT, 0, 100), isolationism: clamp(next.isolationism - DRIFT_AMOUNT, 0, 100) }
        break
      case 'WAR_LOST':
        next = { ...next, aggression: clamp(next.aggression - DRIFT_AMOUNT, 0, 100), isolationism: clamp(next.isolationism + DRIFT_AMOUNT, 0, 100) }
        break
      // Watching a neighbor's collapse ripple (#103) reach you breeds
      // wariness of the outside world, not aggression toward it.
      case 'COLLAPSE_RIPPLE_SURVIVED':
        next = { ...next, isolationism: clamp(next.isolationism + DRIFT_AMOUNT, 0, 100) }
        break
      // A paid-off ambition reinforces the wealth-building instinct that
      // funded it, regardless of which goal it was pursuing.
      case 'AMBITION_SUCCEEDED':
        next = { ...next, mercantilism: clamp(next.mercantilism + DRIFT_AMOUNT, 0, 100) }
        break
      // A failed ambition breeds doctrinal rigidity rather than
      // reconsideration — the setback is blamed on insufficient conviction,
      // not the plan itself.
      case 'AMBITION_FAILED':
        next = { ...next, zealotry: clamp(next.zealotry + DRIFT_AMOUNT, 0, 100) }
        break
    }
  }
  return next
}

function beliefVectorsEqual(a: BeliefVector, b: BeliefVector): boolean {
  return BELIEF_AXES.every((axis) => a[axis] === b[axis])
}

/** The one WorldEvent type/newValue/origin shape this handler reacts to, mapped to a BeliefDriftEvent — or null if it's not one of ours (stalemate, an unrelated field, etc). */
function classifyWorldEvent(row: { type: string; newValue: string | null; origin: string; wakeSourceType: string | null }): BeliefDriftEvent | null {
  if (row.type === 'faction.warResolved') {
    if (row.newValue === 'attacker') return { kind: 'WAR_WON' }
    if (row.newValue === 'defender') return { kind: 'WAR_LOST' }
    return null // stalemate — no clean win/loss signal
  }
  if (row.type === 'faction.warEnded') {
    // Only ever logged for the surviving side (see warTick.ts) — outlasting
    // an opponent whose side collapsed reads as a win for belief purposes.
    return { kind: 'WAR_WON' }
  }
  if (row.type === 'faction.ambitionResolved') {
    return row.newValue === 'succeeded' ? { kind: 'AMBITION_SUCCEEDED' } : { kind: 'AMBITION_FAILED' }
  }
  // #310: origin: 'wake' alone doesn't distinguish a genuine
  // death/collapse ripple (npcDispositionTick.ts's sibling classifier has
  // the same fix, see its own comment) from economyTick.ts's
  // FACTION_DEFAULT loan-default cascade, which writes the identical
  // shape. A faction surviving its OWN neighborhood's collapse is a real
  // belief-shaping event; absorbing a hit because an ally couldn't repay a
  // loan isn't the same story.
  if (row.type === 'faction.stability' && row.origin === 'wake' && (row.wakeSourceType === 'NPC' || row.wakeSourceType === 'FACTION')) {
    return { kind: 'COLLAPSE_RIPPLE_SURVIVED' }
  }
  return null
}

const RELEVANT_EVENT_TYPES = ['faction.warResolved', 'faction.warEnded', 'faction.ambitionResolved', 'faction.stability']

/**
 * How far back a faction that has missed several rotations may catch up in
 * one tick. Without a bound, a faction re-entering the roster after a long
 * absence would scan its entire event history in one pass — inside the
 * shared 20s tick transaction.
 *
 * Drift older than this is genuinely forgotten, which is the honest
 * behaviour for a belief model: an event nobody reacted to for 30 turns
 * has stopped being news.
 */
export const MAX_BELIEF_CATCHUP_TURNS = 30

export async function tickBeliefDrift(ctx: TickContext): Promise<TickHandlerResult> {
  // #375: the watermark is PER FACTION, not per campaign.
  //
  // It used to be WorldMeta.beliefDriftProcessedThroughTurn: one value for
  // the whole campaign, advanced past turn T after processing only the
  // capped subset of factions that won that tick's rotation. Every faction
  // that lost the rotation never received turn T's drift, and the
  // campaign-level watermark guaranteed it never would. Pre-rotation that
  // lost a stable (if unfair) subset; rotation spread the loss across the
  // whole roster.
  //
  // Now each faction carries its own high-water mark and processes the
  // window (its watermark, targetTurn] whenever it is selected — so drift
  // is exactly-once per faction regardless of which ticks it wins, and a
  // faction that missed three rotations catches up on all three.
  const targetTurn = ctx.turnNumber - 1

  const factions = await ctx.db.faction.findMany({
    where: {
      campaignId: ctx.campaignId,
      isActive: true,
      ...rosterFactionFilter(ctx),
      // Nothing to do for a faction already current — cheaper to exclude
      // in SQL than to fetch and skip.
      OR: [
        { beliefDriftThroughTurn: null },
        { beliefDriftThroughTurn: { lt: targetTurn } },
      ],
    },
    select: { id: true, name: true, beliefVector: true, beliefDriftThroughTurn: true },
  })
  if (factions.length === 0) return { changes: [] }

  const changes: WorldChange[] = []

  for (const faction of factions) {
    // Everything since this faction last drifted, bounded — not just
    // targetTurn, so a faction that lost two rotations doesn't silently
    // skip those turns' events.
    const fromTurn = Math.max(
      (faction.beliefDriftThroughTurn ?? -1) + 1,
      targetTurn - MAX_BELIEF_CATCHUP_TURNS
    )
    const events = await ctx.db.worldEvent.findMany({
      where: {
        campaignId: ctx.campaignId,
        turnNumber: { gte: fromTurn, lte: targetTurn },
        targetType: 'FACTION',
        targetId: faction.id,
        type: { in: RELEVANT_EVENT_TYPES },
      },
      select: { type: true, newValue: true, origin: true, wakeSourceType: true },
    })

    const driftEvents = events
      .map((row) => classifyWorldEvent({ type: row.type, newValue: row.newValue, origin: row.origin, wakeSourceType: row.wakeSourceType }))
      .filter((e): e is BeliefDriftEvent => e !== null)

    const current = parseBeliefVector(faction.beliefVector) ?? NEUTRAL_BELIEF
    const next = driftEvents.length > 0 ? decideBeliefDrift(current, driftEvents) : current
    const drifted = driftEvents.length > 0 && !beliefVectorsEqual(current, next)

    // One write per faction. The watermark advances whether or not
    // anything drifted — an empty window is a real answer to "did
    // anything happen in these turns", not a reason to re-ask next tick —
    // and the drifted vector rides along when there is one.
    if (!ctx.dryRun) {
      await ctx.db.faction.update({
        where: { id: faction.id },
        data: {
          beliefDriftThroughTurn: targetTurn,
          ...(drifted ? { beliefVector: next as object } : {}),
        },
      })
    }

    if (!drifted) continue

    changes.push({
      entityType: 'FACTION',
      entityId: faction.id,
      entityName: faction.name,
      campaignId: ctx.campaignId,
      field: 'beliefVector',
      previousValue: JSON.stringify(current),
      newValue: JSON.stringify(next),
      reason: `${faction.name}'s outlook shifts in response to recent events`,
      // Background disposition drift, same significance tier as weatherTick's
      // severity wobbles — not on its own worth a history/RAG entry.
      significant: false,
      importance: 'NORMAL',
    })
  }

  return { changes }
}
