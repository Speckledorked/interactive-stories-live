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
// Deliberately reads only the IMMEDIATELY PRECEDING turn's events (not full
// history) — "recent events," not "everything that ever happened" — so
// nothing needs a separate "already processed" marker the way tickWake's
// ActiveWake rows do: an event is only ever eligible on the one turn right
// after it happened, then ages out on its own.
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

export async function tickBeliefDrift(ctx: TickContext): Promise<TickHandlerResult> {
  // #276: idle-cron ticking can invoke this handler with the SAME
  // turnNumber over and over (WorldMeta.currentTurnNumber only advances
  // via scene resolution — nothing else ever moves it, despite this
  // file's own window looking like it should). Short-circuit once this
  // campaign's watermark already covers the turn this pass would query,
  // so the exact same WorldEvent rows never get reclassified into fresh
  // drift a second time. See the watermark fields' own doc comment on
  // WorldMeta for the full picture.
  const targetTurn = ctx.turnNumber - 1
  const meta = await ctx.db.worldMeta.findUnique({
    where: { campaignId: ctx.campaignId },
    select: { beliefDriftProcessedThroughTurn: true },
  })
  if (meta && meta.beliefDriftProcessedThroughTurn !== null && meta.beliefDriftProcessedThroughTurn >= targetTurn) {
    return { changes: [] }
  }

  const factions = await ctx.db.faction.findMany({
    where: { campaignId: ctx.campaignId, isActive: true },
    orderBy: { createdAt: 'asc' },
    take: ctx.factionCap,
    select: { id: true, name: true, beliefVector: true },
  })
  if (factions.length === 0) return { changes: [] }

  const changes: WorldChange[] = []

  for (const faction of factions) {
    const events = await ctx.db.worldEvent.findMany({
      where: {
        campaignId: ctx.campaignId,
        turnNumber: targetTurn,
        targetType: 'FACTION',
        targetId: faction.id,
        type: { in: RELEVANT_EVENT_TYPES },
      },
      select: { type: true, newValue: true, origin: true, wakeSourceType: true },
    })

    const driftEvents = events
      .map((row) => classifyWorldEvent({ type: row.type, newValue: row.newValue, origin: row.origin, wakeSourceType: row.wakeSourceType }))
      .filter((e): e is BeliefDriftEvent => e !== null)
    if (driftEvents.length === 0) continue

    const current = parseBeliefVector(faction.beliefVector) ?? NEUTRAL_BELIEF
    const next = decideBeliefDrift(current, driftEvents)
    if (beliefVectorsEqual(current, next)) continue

    if (!ctx.dryRun) {
      await ctx.db.faction.update({ where: { id: faction.id }, data: { beliefVector: next as object } })
    }

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

  // Mark this turn as scanned regardless of whether any faction actually
  // drifted — an empty result is still a real answer to "did anything
  // change in this window", not a reason to re-ask the same question
  // next pass.
  if (!ctx.dryRun) {
    // updateMany (not update) — some campaigns in tests/older data may
    // predate a WorldMeta row; degrade to a no-op rather than throwing.
    await ctx.db.worldMeta.updateMany({
      where: { campaignId: ctx.campaignId },
      data: { beliefDriftProcessedThroughTurn: targetTurn },
    })
  }

  return { changes }
}
