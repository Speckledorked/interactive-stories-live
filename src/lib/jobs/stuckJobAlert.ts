// src/lib/jobs/stuckJobAlert.ts
// Global stuck-job alerting for #12 (alpha instrumentation). The per-campaign
// recovery sweeps (lib/game/resolutionQueue.ts, lib/lore/loreQueue.ts) are
// traffic-driven: they only run when someone is looking at THAT campaign,
// so a genuinely abandoned campaign's stuck job has no one to trigger
// recovery. This is the other half — a check that scans ALL campaigns,
// piggybacked on the internal worker routes (which fire on any real usage
// of the app, not just the stuck one), and fires reportError so a solo
// operator's phone buzzes even if nobody is looking at the stuck scene.
//
// No cron on this deployment target (see README Phase 9), so this is
// best-effort and opportunistic like everything else here — it runs a bit
// late on a quiet app, never not at all.

import { reportError } from '@/lib/monitoring'

// Comfortably past the per-campaign recovery thresholds (PENDING_STALE_MS,
// RUNNING_STALE_MS in resolutionQueue.ts/loreQueue.ts) — this only fires
// for jobs recovery has plainly failed to move, not ones still mid-retry.
export const ALERT_THRESHOLD_MS = 20 * 60 * 1000

export interface StuckJobCandidate {
  id: string
  status: string
  updatedAt: Date
  startedAt: Date | null
  alertedStuckAt: Date | null
}

/**
 * Pure: has this job been sitting in PENDING/RUNNING long enough, without
 * having been alerted on already, to be worth a global alert?
 */
export function isStuckPastAlertThreshold(job: StuckJobCandidate, nowMs: number): boolean {
  if (job.alertedStuckAt) return false
  if (job.status !== 'PENDING' && job.status !== 'RUNNING') return false
  const referenceMs = (job.status === 'RUNNING' ? job.startedAt?.getTime() : null) ?? job.updatedAt.getTime()
  return nowMs - referenceMs >= ALERT_THRESHOLD_MS
}

interface JobModel {
  findMany(args: {
    where: { status: { in: string[] }; alertedStuckAt: null }
    select: { id: true; campaignId: true; status: true; updatedAt: true; startedAt: true; alertedStuckAt: true }
    take: number
  }): Promise<Array<StuckJobCandidate & { campaignId: string }>>
  update(args: { where: { id: string }; data: { alertedStuckAt: Date } }): Promise<unknown>
}

/**
 * Scan up to `take` live jobs on the given model for ones stuck past the
 * alert threshold, report each once, and stamp alertedStuckAt so a repeat
 * sweep never re-alerts the same job. Never throws — instrumentation must
 * not be able to break the worker route it's piggybacked on.
 */
export async function alertStuckJobs(
  model: JobModel,
  context: 'resolution-job-stuck' | 'lore-import-job-stuck' | 'reseed-job-stuck',
  take = 25
): Promise<void> {
  try {
    const candidates = await model.findMany({
      where: { status: { in: ['PENDING', 'RUNNING'] }, alertedStuckAt: null },
      select: { id: true, campaignId: true, status: true, updatedAt: true, startedAt: true, alertedStuckAt: true },
      take,
    })
    const now = Date.now()
    for (const job of candidates) {
      if (!isStuckPastAlertThreshold(job, now)) continue
      const ageMinutes = Math.round((now - (job.startedAt?.getTime() ?? job.updatedAt.getTime())) / 60000)
      await reportError(context, new Error(`Job stuck in ${job.status} for ~${ageMinutes}m`), {
        jobId: job.id, campaignId: job.campaignId, status: job.status, ageMinutes,
      })
      await model.update({ where: { id: job.id }, data: { alertedStuckAt: new Date() } })
    }
  } catch (error) {
    console.error(`Stuck-job alert sweep failed (non-critical, context=${context}):`, error)
  }
}
