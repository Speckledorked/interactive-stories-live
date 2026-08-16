// src/lib/game/retention.ts
// #408: something that deletes rows.
//
// Eighteen append-only tables, one of which was ever pruned. `WorldEvent`,
// `EventWitness`, `PopulationFlightEvent`, `TimelineEvent`, `DiceRoll`,
// `Message`, `StateMutation`, `WikiEntry`, `AIValidationFailure`,
// `MemoryCreationFailure`, `ActiveWake`, `Arc`, `FactionDebt`,
// `LoreCitation`, `GmClarification`, `AICostEntry` and `AnalyticsEvent` all
// had zero delete sites; only `CampaignMemory` was bounded, via
// consolidation — and ARCHITECTURE.md's claim that consolidation "keeps a
// long campaign's memory table bounded" was doing more work than it should,
// since it bounds one table out of eighteen.
//
// Retention was never part of the model-authoring convention. Each table
// was added for a real consumer and the question "what removes these rows"
// was not on the checklist — so the answer is uniformly "nothing",
// including for tables no consumer reads at all.
//
// `WorldEvent` and `EventWitness` are the acute pair. A single world turn
// writes ~40 WorldEvent rows, and beliefTick/npcDispositionTick derive
// drift by COUNTING prior-turn rows — so the table is not merely storage,
// it is a hot read path whose cost grows monotonically for the life of the
// campaign.
//
// ── The window ────────────────────────────────────────────────────────────
//
// The binding constraint is NOT disk. It is that the derive-by-counting
// readers must never outlive their own data: beliefTick and
// npcDispositionTick walk back to a per-entity watermark bounded by
// MAX_BELIEF_CATCHUP_TURNS (30 simulation turns), and informationTick reads
// a window bounded by FALLBACK_MAX_WINDOW_TURNS (60). Deleting inside
// either window would not free space so much as silently change the
// simulation.
//
// So retention is expressed in SIMULATION TURNS, not days, and sits well
// clear of the widest reader's window. Time-based retention would be wrong
// here for the same reason the frozen turn counter was wrong: an idle
// campaign's real-time age says nothing about how much simulation has
// happened in it.

import { prisma } from '@/lib/prisma'
import { FALLBACK_MAX_WINDOW_TURNS } from './tick/informationTick'

/**
 * How many simulation turns of event history to keep.
 *
 * Comfortably wider than every reader: informationTick's 60-turn fallback
 * window is the widest, and this is deliberately several multiples of it
 * so that widening a reader later does not silently start reading deleted
 * rows. A campaign running one world turn per in-game day keeps roughly a
 * year of history.
 */
export const EVENT_RETENTION_TURNS = Math.max(FALLBACK_MAX_WINDOW_TURNS * 6, 360)

/**
 * Rows removed per table per run.
 *
 * Bounded because this shares a cron invocation with the world-turn sweep,
 * which has its own duration budget — see #409. A backlog is worked off
 * across runs rather than in one long delete that could take the sweep
 * down with it.
 */
export const RETENTION_BATCH_SIZE = 5_000

/**
 * AICostEntry is genuinely time-based rather than turn-based — it is
 * billing telemetry, and what matters is the reporting period, not how much
 * simulation happened. Two years matches
 * ANALYTICS_TOTALS_LOOKBACK_DAYS so "totals" and "what is retained" cannot
 * silently disagree.
 */
export const AI_COST_RETENTION_MS = 730 * 24 * 60 * 60 * 1000

export interface RetentionResult {
  worldEventsDeleted: number
  eventWitnessesDeleted: number
  diceRollsDeleted: number
  aiCostEntriesDeleted: number
}

/**
 * Prune one campaign's oldest event history.
 *
 * Deliberately narrow: the four highest-volume tables, and only those.
 * `TimelineEvent` and `CampaignLog` are the player-facing chronicle — the
 * durable record a returning player reads — and pruning those would delete
 * the very thing the away-recap gap is about. `Message`, `WikiEntry` and
 * the failure tables are small, or are read on demand, or are the evidence
 * someone would want precisely when something has gone wrong.
 */
export async function pruneCampaignHistory(campaignId: string): Promise<RetentionResult> {
  const meta = await prisma.worldMeta.findUnique({
    where: { campaignId },
    select: { simulationTurn: true },
  })
  const cutoffTurn = (meta?.simulationTurn ?? 0) - EVENT_RETENTION_TURNS

  // A campaign younger than the window has nothing to prune, and a
  // negative cutoff would be a no-op query run for every campaign on every
  // sweep.
  if (cutoffTurn <= 0) {
    return { worldEventsDeleted: 0, eventWitnessesDeleted: 0, diceRollsDeleted: 0, aiCostEntriesDeleted: 0 }
  }

  // EventWitness rows hang off WorldEvent, so they go first — otherwise the
  // FK cascade decides the order and the batch bound stops meaning
  // anything.
  const staleEventIds = await prisma.worldEvent.findMany({
    where: { campaignId, turnNumber: { lt: cutoffTurn } },
    select: { id: true },
    take: RETENTION_BATCH_SIZE,
    orderBy: { turnNumber: 'asc' },
  })

  if (staleEventIds.length === 0) {
    return { worldEventsDeleted: 0, eventWitnessesDeleted: 0, diceRollsDeleted: 0, aiCostEntriesDeleted: 0 }
  }

  const ids = staleEventIds.map((e) => e.id)
  const witnesses = await prisma.eventWitness.deleteMany({ where: { worldEventId: { in: ids } } })
  const events = await prisma.worldEvent.deleteMany({ where: { id: { in: ids } } })

  // DiceRoll and AICostEntry are pure telemetry with no reader in the
  // simulation at all — DiceRoll's own audit finding is that its rollType
  // is read by nothing but the exporter. DiceRoll has no turnNumber, so it
  // is pruned on the same real-time basis as cost entries.
  const diceRolls = await prisma.diceRoll.deleteMany({
    where: { campaignId, createdAt: { lt: new Date(Date.now() - AI_COST_RETENTION_MS) } },
  })
  const costEntries = await prisma.aICostEntry.deleteMany({
    where: { campaignId, createdAt: { lt: new Date(Date.now() - AI_COST_RETENTION_MS) } },
  })

  return {
    worldEventsDeleted: events.count,
    eventWitnessesDeleted: witnesses.count,
    diceRollsDeleted: diceRolls.count,
    aiCostEntriesDeleted: costEntries.count,
  }
}

