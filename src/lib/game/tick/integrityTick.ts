// src/lib/game/tick/integrityTick.ts
// TickHandler adapter for the Integrity Engine (game/integrity/) — runs
// LAST in TICK_HANDLERS (see worldTick.ts) so it validates the state the
// turn actually produced, after every other handler has already written.
//
// Phase 2: every real pass (never a dry run) also persists its report to
// WorldMeta, the same bounded-history shape campaign-health.ts already
// proved out, so the admin integrity panel has something to read.

import { TickContext, TickHandlerResult } from './types'
import { runIntegrityPass } from '../integrity/runIntegrityPass'
import { persistIntegrityReport } from '../integrity/persistReport'

export async function tickIntegrity(ctx: TickContext): Promise<TickHandlerResult> {
  const { changes, report } = await runIntegrityPass(ctx.db, ctx.campaignId, ctx.turnNumber, { dryRun: ctx.dryRun })

  // A dry run (admin tick preview) must not persist a report — it's not a
  // real pass, and would pollute the history with a check that never
  // actually applied anything.
  if (!ctx.dryRun) {
    await persistIntegrityReport(ctx.db, report)
  }

  if (report.violationsFound > 0) {
    console.log(
      `🩺 Integrity pass for ${ctx.campaignId}: ${report.violationsFound} violation(s), ` +
      `${report.repairsApplied} repaired, ${report.unrepaired.length} unrepaired` +
      (report.escalations.length > 0 ? `, ${report.escalations.length} escalation(s)` : '') +
      (ctx.dryRun ? ' (dry run — nothing written)' : '')
    )
  }

  return { changes }
}
