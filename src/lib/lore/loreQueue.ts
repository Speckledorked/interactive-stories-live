// src/lib/lore/loreQueue.ts
// Async lore import: a paste, a URL fetch, or a whole wiki crawl can take
// anywhere from under a second to a couple of minutes, so importing runs
// off the request path exactly like scene resolution does (see
// lib/game/resolutionQueue.ts, which this mirrors). Creating a
// LoreImportJob returns immediately; the job runs in its own invocation of
// the internal worker route, and the admin UI polls job status.
//
// Recovery model: same as resolutionQueue — no cron on this deployment
// target, so stuck jobs are recovered opportunistically by admin traffic
// polling job status.

import { prisma } from '@/lib/prisma'
import type { LoreImportJobStatus } from '@prisma/client'
import { internalJobSecret } from '@/lib/game/resolutionQueue'
import { reportError } from '@/lib/monitoring'
import { getAppUrl } from '@/lib/appUrl'
import { runLoreImport } from './loreImportService'
import { clearPendingWorldSeed } from './reseedWorld'
import { kickReseedJob } from './reseedQueue'
import { alertStuckJobs } from '@/lib/jobs/stuckJobAlert'

export const MAX_ATTEMPTS = 3
// A wiki crawl can legitimately run for minutes; a RUNNING job older than
// this is presumed dead rather than just slow.
export const RUNNING_STALE_MS = 8 * 60 * 1000
export const PENDING_STALE_MS = 45 * 1000
const KICK_DELIVERY_TIMEOUT_MS = 3000

/**
 * Kick off (or reuse) the import job's worker invocation. Callers create
 * the LoreImportJob row themselves (via prisma.loreImportJob.create, from
 * the API route that also validates the request body) — this just hands
 * an already-created job to the worker.
 */
export async function kickLoreImportJob(jobId: string): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), KICK_DELIVERY_TIMEOUT_MS)
  try {
    await fetch(`${getAppUrl()}/api/internal/process-lore-import`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': internalJobSecret(),
      },
      body: JSON.stringify({ jobId }),
      signal: controller.signal,
    })
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') {
      return
    }
    console.error('Lore import kick failed — falling back to inline processing:', error)
    await processLoreImportJob(jobId)
  } finally {
    clearTimeout(timer)
  }
}

export interface ProcessResult {
  status: 'completed' | 'failed' | 'retry_scheduled' | 'skipped'
  error?: string
}

/**
 * Run one job to completion. Atomic claim (PENDING → RUNNING) means
 * concurrent kicks and recovery sweeps can all call this safely — only one
 * caller wins.
 */
export async function processLoreImportJob(jobId: string): Promise<ProcessResult> {
  const claimed = await prisma.loreImportJob.updateMany({
    where: { id: jobId, status: 'PENDING' },
    data: { status: 'RUNNING', startedAt: new Date(), attempts: { increment: 1 } },
  })
  if (claimed.count === 0) {
    return { status: 'skipped' }
  }

  const job = await prisma.loreImportJob.findUnique({ where: { id: jobId } })
  if (!job) return { status: 'skipped' }

  // A retry re-runs the whole source from scratch (chunk boundaries/page
  // lists aren't stable enough to resume mid-way) — clear whatever this
  // job stored on its previous, failed attempt so it doesn't duplicate.
  if (job.attempts > 1) {
    await prisma.loreEntry.deleteMany({ where: { jobId } })
  }

  try {
    await runLoreImport(job)
    await prisma.loreImportJob.update({
      where: { id: jobId },
      data: { status: 'COMPLETED', finishedAt: new Date(), lastError: null },
    })
    console.log(`✅ Lore import job ${jobId} completed`)

    // Campaigns created WITH a lore source finish becoming their canon
    // world here: the import that was still crawling when the campaign was
    // born now reseeds the provisional generated world (fresh-mode replace
    // while no characters exist — see lib/lore/reseedWorld.ts). Runs as its
    // own ReseedJob (lib/lore/reseedQueue.ts) rather than inline: it makes
    // up to two more sequential AI calls on top of whatever budget this
    // import invocation already spent crawling, real timeout risk for a
    // large source. releasesPlayLock: true means that job's own completion
    // (success, clean failure, or exhausted retries) takes the lock off —
    // never held hostage by a stuck reseed, and the campaign continues on
    // whichever world it has in the meantime.
    if (job.autoReseedOnComplete) {
      try {
        const reseedJob = await prisma.reseedJob.create({
          data: { campaignId: job.campaignId, releasesPlayLock: true },
        })
        await kickReseedJob(reseedJob.id)
      } catch (reseedError) {
        console.error(`❌ Failed to start auto-reseed after lore import ${jobId}:`, reseedError)
        await reportError('lore-auto-reseed-failed', reseedError, {
          jobId, campaignId: job.campaignId,
        })
        // No ReseedJob exists to own releasing the lock — do it directly
        // so a failed kick can't strand the campaign locked forever.
        await clearPendingWorldSeed(job.campaignId).catch(e =>
          console.error('Failed to clear pendingWorldSeed:', e)
        )
      }
    }

    return { status: 'completed' }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const retryable = job.attempts < MAX_ATTEMPTS
    await prisma.loreImportJob.update({
      where: { id: jobId },
      data: {
        status: retryable ? 'PENDING' : 'FAILED',
        lastError: message.slice(0, 1000),
        ...(retryable ? {} : { finishedAt: new Date() }),
      },
    }).catch(e => console.error('Failed to record lore import job failure:', e))
    console.error(`❌ Lore import job ${jobId} attempt ${job.attempts} failed:`, message)
    if (!retryable) {
      await reportError('lore-import-job-failed', error, {
        jobId, campaignId: job.campaignId, sourceType: job.sourceType, attempts: job.attempts,
      })
      // A permanently failed creation-time import unlocks the campaign on
      // its provisional world rather than holding players hostage.
      if (job.autoReseedOnComplete) {
        await clearPendingWorldSeed(job.campaignId).catch(e =>
          console.error('Failed to clear pendingWorldSeed after failed import:', e)
        )
      }
    }
    return retryable ? { status: 'retry_scheduled', error: message } : { status: 'failed', error: message }
  }
}

// ---------------------------------------------------------------------------
// Opportunistic recovery (pure decision + traffic-driven sweep)
// ---------------------------------------------------------------------------

export interface JobForRecovery {
  id: string
  status: LoreImportJobStatus
  attempts: number
  updatedAt: Date
  startedAt: Date | null
}

export type RecoveryDecision = 'kick' | 'reset_and_kick' | 'fail' | 'wait'

/** Pure: what to do with one live job during a recovery sweep. */
export function classifyStaleLoreJob(job: JobForRecovery, nowMs: number): RecoveryDecision {
  if (job.status === 'PENDING') {
    return nowMs - job.updatedAt.getTime() >= PENDING_STALE_MS ? 'kick' : 'wait'
  }
  if (job.status === 'RUNNING') {
    const startedMs = job.startedAt?.getTime() ?? job.updatedAt.getTime()
    if (nowMs - startedMs < RUNNING_STALE_MS) return 'wait'
    return job.attempts >= MAX_ATTEMPTS ? 'fail' : 'reset_and_kick'
  }
  return 'wait'
}

/**
 * Best-effort recovery of this campaign's stuck lore import jobs,
 * piggybacked on the admin lore-list GET (an admin watching a stuck import
 * is the retry loop). Never throws.
 */
export async function recoverStaleLoreJobs(campaignId: string): Promise<void> {
  try {
    const live = await prisma.loreImportJob.findMany({
      where: { campaignId, status: { in: ['PENDING', 'RUNNING'] } },
      select: { id: true, status: true, attempts: true, updatedAt: true, startedAt: true, autoReseedOnComplete: true },
      take: 5,
    })
    const now = Date.now()

    for (const job of live) {
      const decision = classifyStaleLoreJob(job, now)
      if (decision === 'wait') continue

      if (decision === 'fail') {
        await prisma.loreImportJob.update({
          where: { id: job.id },
          data: { status: 'FAILED', finishedAt: new Date(), lastError: 'Abandoned after repeated stalls' },
        })
        console.warn(`⚠️ Lore import job ${job.id} abandoned (stale RUNNING, out of attempts)`)
        await reportError('lore-import-job-abandoned', new Error('Stale RUNNING job out of attempts'), {
          jobId: job.id, campaignId,
        })
        // An abandoned creation-time import must release the play lock.
        if (job.autoReseedOnComplete) {
          await clearPendingWorldSeed(campaignId).catch(e =>
            console.error('Failed to clear pendingWorldSeed after abandoned import:', e)
          )
        }
        continue
      }

      if (decision === 'reset_and_kick') {
        const reset = await prisma.loreImportJob.updateMany({
          where: { id: job.id, status: 'RUNNING' },
          data: { status: 'PENDING' },
        })
        if (reset.count === 0) continue
        console.warn(`🔁 Lore import job ${job.id} reset from stale RUNNING`)
      }

      await kickLoreImportJob(job.id)
    }
  } catch (error) {
    console.error('Stale lore job recovery failed (non-critical):', error)
  }
}

/**
 * Global counterpart to recoverStaleLoreJobs — see
 * resolutionQueue.sweepGloballyStuckResolutionJobs for why this exists
 * separately from the per-campaign sweep above.
 */
export async function sweepGloballyStuckLoreJobs(): Promise<void> {
  await alertStuckJobs(prisma.loreImportJob as any, 'lore-import-job-stuck')
}
