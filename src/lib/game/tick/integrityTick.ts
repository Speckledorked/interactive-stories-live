// src/lib/game/tick/integrityTick.ts
// TickHandler adapter for the Integrity Engine (game/integrity/) — runs
// LAST in TICK_HANDLERS (see worldTick.ts) so it validates the state the
// turn actually produced, after every other handler has already written.
//
// Structured, persistent reporting (a WorldMeta-backed history the admin
// panel reads) is Phase 2 and not built yet — this phase logs a summary and
// relies on the existing changes[] fan-out (persistWorldEvents in
// particular) to make repairs visible and auditable in the interim.

import { prisma } from '@/lib/prisma'
import { TickContext, TickHandlerResult } from './types'
import { runIntegrityPass } from '../integrity/runIntegrityPass'

export async function tickIntegrity(ctx: TickContext): Promise<TickHandlerResult> {
  const { changes, report } = await runIntegrityPass(prisma, ctx.campaignId, ctx.turnNumber, { dryRun: ctx.dryRun })

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
