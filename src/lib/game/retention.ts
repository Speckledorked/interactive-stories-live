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

/**
 * C-13/#442: how long an ARCHIVED memory is kept before it is finally
 * deleted.
 *
 * #392 made consolidation archive rather than delete — safer for the data,
 * and it left memoryConsolidation's own stated purpose ("so the table stays
 * bounded") unmet, because nothing ever retired an archived row. A year is
 * deliberately long: an archived memory is already invisible to every
 * retrieval path, so the only thing this window buys is the ability to
 * recover from a consolidation that archived too aggressively.
 */
export const ARCHIVED_MEMORY_RETENTION_MS = 365 * 24 * 60 * 60 * 1000

/**
 * #445: how long a MemoryCreationFailure row is kept.
 *
 * This table is WRITE-ONLY today, and that is not the same thing as dead.
 * #284 added it deliberately, and its own comment says why the full payload
 * is stored rather than an error string: "so it's queryable and a future
 * retry/reader can recreate the memory exactly, not reconstruct it from the
 * original scene from scratch." That reader still does not exist — a real
 * open gap, and one this pass deliberately does NOT close by deleting the
 * model, which would throw away the record of every scene that silently
 * vanished from campaign history.
 *
 * What it does close is the unbounded growth: #408's own module comment lists
 * this among the eighteen tables with zero delete sites, and it was still one
 * of them. The window is deliberately long — far longer than any plausible
 * retry horizon — so adding that reader later still finds something to work
 * with. The rows are rare by construction (one per memory-creation failure,
 * on a path that already fails open), so a generous window costs nothing.
 */
export const MEMORY_FAILURE_RETENTION_MS = 180 * 24 * 60 * 60 * 1000

export interface RetentionResult {
  worldEventsDeleted: number
  eventWitnessesDeleted: number
  diceRollsDeleted: number
  aiCostEntriesDeleted: number
  /** C-13/#442: archived memories, which had no retention pass at all. */
  archivedMemoriesDeleted: number
  /** #445: memory-creation failures — write-only, and previously unbounded. */
  memoryFailuresDeleted: number
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
  // #442: telemetry FIRST, and unconditionally.
  //
  // DiceRoll and AICostEntry are pruned on a real-time basis
  // (`createdAt < now - AI_COST_RETENTION_MS`) and have nothing whatsoever
  // to do with simulation turns. They used to sit BELOW two early returns
  // keyed on a different table's age — `cutoffTurn <= 0` and
  // `staleEventIds.length === 0` — so the two highest-volume telemetry
  // tables in the schema were never pruned at all until a campaign was old
  // enough to have stale WORLD EVENTS. That is backwards: telemetry
  // accumulates fastest early, when play is most active, and the audit's
  // ~360-turn threshold means "nearly every campaign, forever".
  //
  // An early return is a claim about the whole function. These deletes have
  // their own criteria, so they belong above any return that does not.
  const telemetryCutoff = new Date(Date.now() - AI_COST_RETENTION_MS)
  const diceRolls = await prisma.diceRoll.deleteMany({
    where: { campaignId, createdAt: { lt: telemetryCutoff } },
  })
  const costEntries = await prisma.aICostEntry.deleteMany({
    where: { campaignId, createdAt: { lt: telemetryCutoff } },
  })

  // C-13/#442: the memory archive had no retention pass at all.
  //
  // #392 changed consolidation from delete to ARCHIVE, which is safer for
  // the data and left memoryConsolidation's own stated purpose — "so the
  // table stays bounded" — unmet, because nothing ever retired an archived
  // row. Archived memories are already excluded from every retrieval path,
  // so this is the one place they can go.
  const archivedMemories = await prisma.campaignMemory.deleteMany({
    where: { campaignId, archivedAt: { lt: new Date(Date.now() - ARCHIVED_MEMORY_RETENTION_MS) } },
  })

  // #445: the last write-only table with no delete site. Real-time cutoff for
  // the same reason the telemetry deletes have one — these rows record a
  // wall-clock failure, not a simulation event — which is also why this sits
  // above the turn-keyed early return below. See
  // MEMORY_FAILURE_RETENTION_MS for why the window is long and why the
  // table is not simply dropped.
  const memoryFailures = await prisma.memoryCreationFailure.deleteMany({
    where: { campaignId, createdAt: { lt: new Date(Date.now() - MEMORY_FAILURE_RETENTION_MS) } },
  })

  const empty = (): RetentionResult => ({
    worldEventsDeleted: 0,
    eventWitnessesDeleted: 0,
    diceRollsDeleted: diceRolls.count,
    aiCostEntriesDeleted: costEntries.count,
    archivedMemoriesDeleted: archivedMemories.count,
    memoryFailuresDeleted: memoryFailures.count,
  })

  const meta = await prisma.worldMeta.findUnique({
    where: { campaignId },
    select: { simulationTurn: true },
  })
  const cutoffTurn = (meta?.simulationTurn ?? 0) - EVENT_RETENTION_TURNS

  // A campaign younger than the window has no WORLD EVENTS to prune, and a
  // negative cutoff would be a no-op query run for every campaign on every
  // sweep. The telemetry above has already been dealt with.
  if (cutoffTurn <= 0) return empty()

  // EventWitness rows hang off WorldEvent, so they go first — otherwise the
  // FK cascade decides the order and the batch bound stops meaning
  // anything.
  const staleEventIds = await prisma.worldEvent.findMany({
    where: { campaignId, turnNumber: { lt: cutoffTurn } },
    select: { id: true },
    take: RETENTION_BATCH_SIZE,
    orderBy: { turnNumber: 'asc' },
  })

  if (staleEventIds.length === 0) return empty()

  const ids = staleEventIds.map((e) => e.id)
  const witnesses = await prisma.eventWitness.deleteMany({ where: { worldEventId: { in: ids } } })
  const events = await prisma.worldEvent.deleteMany({ where: { id: { in: ids } } })

  return {
    worldEventsDeleted: events.count,
    eventWitnessesDeleted: witnesses.count,
    diceRollsDeleted: diceRolls.count,
    aiCostEntriesDeleted: costEntries.count,
    archivedMemoriesDeleted: archivedMemories.count,
    memoryFailuresDeleted: memoryFailures.count,
  }
}

