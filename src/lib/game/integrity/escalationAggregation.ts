// src/lib/game/integrity/escalationAggregation.ts
// Phase 5 (plan section 5b) — the "is anything actually wrong" check, run
// on its own schedule, separate from any single campaign's world tick.
//
// Deliberately AI-free and deterministic: this only reads what Phase 2
// already persisted per campaign (WorldMeta.integrityReportHistory) and
// aggregates it ACROSS campaigns by checkKey. A code defect escalates
// identically in every campaign that exercises the same write path, so
// reacting per-campaign (inside tickIntegrity) would mean N independent
// diagnosis attempts for one root cause — this is the step that collapses
// that back into one.
//
// Only checkKeys with an attributed source (escalationSourceMap.ts) are
// returned — an escalation with nowhere to start a fix from is real
// evidence (already surfaced per-campaign by escalation.ts/Phase 2's
// panel) but not something this pipeline can act on, and it should not be
// half-acted on either.
//
// Reads only each campaign's MOST RECENT report, not its whole history.
// An earlier version of this function walked every report in the
// lookback window, which meant an already-merged fix could be
// "rediscovered" from a stale, pre-fix report still inside the window —
// confirmed and fixed here (see the Fix Log in docs/ARCHITECTURE.md). This also matters for
// regressionDetection.ts: a genuine recurrence has to be read from
// current state, not replayed from history that predates the fix.

import type { Prisma, PrismaClient } from '@prisma/client'
import { Escalation, IntegrityReport } from './types'
import { ESCALATION_SOURCE_FILES, hasAttributedSource } from './escalationSourceMap'
import { OracleTechnique, oracleTechniqueFor } from './oracleTechnique'
import { CheckKey } from './checkKeys'

type Db = Prisma.TransactionClient | PrismaClient

export interface AggregatedEscalation {
  checkKey: string
  /** Every distinct campaign this checkKey escalated in within the lookback window. */
  campaignIds: string[]
  /** Sum of Escalation.occurrences across every campaign it fired in. */
  totalOccurrences: number
  sourceFiles: readonly string[]
  oracleTechnique: OracleTechnique
  /** One representative Escalation (first one seen), enough to build a
   * fix-generation prompt without a second DB round-trip. */
  sample: Escalation
}

/** Escalations need multiple turns to accumulate (see escalation.ts's
 * thresholds) and this runs on its own schedule, independent of any one
 * campaign's tick cadence — a lookback window, not "since last run", is
 * what keeps this correct even if a run is skipped, delayed, or this is
 * the very first run. */
export const ESCALATION_LOOKBACK_DAYS = 14

/**
 * Scan every campaign's recent IntegrityReport history for escalations
 * this pipeline could actually act on, aggregated by checkKey. Ordering is
 * not this function's concern — the caller (scripts/check-escalations.ts)
 * decides how many to act on per run and in what order.
 */
export async function findActionableEscalations(db: Db): Promise<AggregatedEscalation[]> {
  const since = new Date(Date.now() - ESCALATION_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)

  const rows = await db.worldMeta.findMany({
    where: { lastIntegrityCheck: { gte: since } },
    select: { campaignId: true, integrityReportHistory: true },
  })

  const byCheckKey = new Map<string, AggregatedEscalation>()

  for (const row of rows) {
    const history = Array.isArray(row.integrityReportHistory)
      ? (row.integrityReportHistory as unknown as IntegrityReport[])
      : []
    if (history.length === 0) continue

    // Only the most recent report — history is append-only and ordered by
    // when tickIntegrity persisted it (see persistReport.ts), so the last
    // entry is the campaign's current state. Anything earlier may already
    // be resolved.
    const latest = history[history.length - 1]

    for (const escalation of latest.escalations ?? []) {
      if (!hasAttributedSource(escalation.checkKey)) continue

      const existing = byCheckKey.get(escalation.checkKey)
      if (existing) {
        if (!existing.campaignIds.includes(row.campaignId)) {
          existing.campaignIds.push(row.campaignId)
        }
        existing.totalOccurrences += escalation.occurrences
      } else {
        byCheckKey.set(escalation.checkKey, {
          checkKey: escalation.checkKey,
          campaignIds: [row.campaignId],
          totalOccurrences: escalation.occurrences,
          sourceFiles: ESCALATION_SOURCE_FILES[escalation.checkKey as CheckKey] ?? [],
          oracleTechnique: oracleTechniqueFor(escalation.checkKey),
          sample: escalation,
        })
      }
    }
  }

  return [...byCheckKey.values()]
}
