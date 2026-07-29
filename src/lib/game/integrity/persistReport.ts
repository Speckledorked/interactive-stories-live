// src/lib/game/integrity/persistReport.ts
// Phase 2: persist each IntegrityReport to WorldMeta, the same bounded-
// history shape campaign-health.ts's recordHealthCheck() already proved out
// (campaignHealthHistory / lastHealthCheck / currentHealthScore) — kept as
// its own pair of columns rather than folded into those, since integrity
// (is the world's data internally coherent) is a different axis from
// campaign health (narrative/operational quality).

import type { Prisma, PrismaClient } from '@prisma/client'
import { IntegrityReport } from './types'

type Db = Prisma.TransactionClient | PrismaClient

const MAX_HISTORY = 30

/**
 * Best-effort: a diagnostics side-channel failing to persist must never
 * fail the tick that already applied real repairs, so errors are logged
 * and swallowed here rather than propagated — same contract as
 * recordHealthCheck().
 */
export async function persistIntegrityReport(db: Db, report: IntegrityReport): Promise<void> {
  try {
    const worldMeta = await db.worldMeta.findUnique({ where: { campaignId: report.campaignId } })
    if (!worldMeta) return

    const history = Array.isArray(worldMeta.integrityReportHistory)
      ? (worldMeta.integrityReportHistory as unknown as IntegrityReport[])
      : []
    history.push(report)
    const recentHistory = history.slice(-MAX_HISTORY)

    await db.worldMeta.update({
      where: { id: worldMeta.id },
      data: {
        integrityReportHistory: recentHistory as unknown as Prisma.InputJsonValue,
        lastIntegrityCheck: new Date(),
      },
    })
  } catch (error) {
    console.error('Error persisting integrity report:', error)
  }
}
