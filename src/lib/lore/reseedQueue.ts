// src/lib/lore/reseedQueue.ts
// Async world reseed: reseedWorldFromLore makes up to two sequential AI
// calls plus a run of DB writes, which can outrun a single serverless
// invocation's time budget for a large lore corpus — exactly the same
// reason lore import itself runs off the request path (see loreQueue.ts,
// which this closely mirrors). A ReseedJob row tracks one attempt;
// kicking it hands the actual work to its own invocation of the internal
// worker route, and callers (the admin "Reseed from lore" button, and the
// creation-time auto-reseed) poll/react to its completion instead of
// awaiting reseedWorldFromLore directly inside their own request.
//
// Because reseedWorldFromLore's writes are incremental against current DB
// state (factions/NPCs/locations dedupe by name, archetypes only
// regenerate if still zero, stat labels/theme only set if unset), a job
// whose invocation gets killed mid-run and is retried doesn't redo
// finished work — each attempt picks up wherever the last one left off
// and keeps making forward progress toward a fully caught-up world.

import { prisma } from '@/lib/prisma'
import type { ReseedJobStatus } from '@prisma/client'
import { internalJobSecret } from '@/lib/game/resolutionQueue'
import { reportError } from '@/lib/monitoring'
import { getAppUrl } from '@/lib/appUrl'
import { reseedWorldFromLore, clearPendingWorldSeed } from './reseedWorld'
import { alertStuckJobs } from '@/lib/jobs/stuckJobAlert'

export const MAX_ATTEMPTS = 3
// Each attempt is at most one invocation's time budget — a RUNNING job
// older than this got killed by the platform mid-run, not just a slow
// AI call. Shorter than lore import's threshold since a reseed attempt is
// a single request/response cycle, not a multi-minute wiki crawl.
export const RUNNING_STALE_MS = 90 * 1000
export const PENDING_STALE_MS = 15 * 1000
const KICK_DELIVERY_TIMEOUT_MS = 3000

/**
 * Kick off (or reuse) the reseed job's worker invocation. Callers create
 * the ReseedJob row themselves — this just hands an already-created job
 * to the worker.
 */
export async function kickReseedJob(jobId: string): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), KICK_DELIVERY_TIMEOUT_MS)
  try {
    await fetch(`${getAppUrl()}/api/internal/process-reseed`, {
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
    console.error('Reseed kick failed — falling back to inline processing:', error)
    await processReseedJob(jobId)
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
export async function processReseedJob(jobId: string): Promise<ProcessResult> {
  const claimed = await prisma.reseedJob.updateMany({
    where: { id: jobId, status: 'PENDING' },
    data: { status: 'RUNNING', startedAt: new Date(), attempts: { increment: 1 } },
  })
  if (claimed.count === 0) {
    return { status: 'skipped' }
  }

  const job = await prisma.reseedJob.findUnique({ where: { id: jobId } })
  if (!job) return { status: 'skipped' }

  try {
    const result = await reseedWorldFromLore(job.campaignId)

    if (!result.ok) {
      // A clean "nothing to do" (no lore imported, campaign gone) isn't a
      // retryable failure — it's just done.
      await prisma.reseedJob.update({
        where: { id: jobId },
        data: { status: 'FAILED', finishedAt: new Date(), lastError: result.reason },
      })
      if (job.releasesPlayLock) {
        await clearPendingWorldSeed(job.campaignId).catch(e =>
          console.error('Failed to clear pendingWorldSeed:', e)
        )
      }
      return { status: 'failed', error: result.reason }
    }

    await prisma.reseedJob.update({
      where: { id: jobId },
      data: { status: 'COMPLETED', finishedAt: new Date(), lastError: null, summary: result.summary as any },
    })
    console.log(`✅ Reseed job ${jobId} completed`)
    if (job.releasesPlayLock) {
      await clearPendingWorldSeed(job.campaignId).catch(e =>
        console.error('Failed to clear pendingWorldSeed:', e)
      )
    }
    return { status: 'completed' }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const retryable = job.attempts < MAX_ATTEMPTS
    await prisma.reseedJob.update({
      where: { id: jobId },
      data: {
        status: retryable ? 'PENDING' : 'FAILED',
        lastError: message.slice(0, 1000),
        ...(retryable ? {} : { finishedAt: new Date() }),
      },
    }).catch(e => console.error('Failed to record reseed job failure:', e))
    console.error(`❌ Reseed job ${jobId} attempt ${job.attempts} failed:`, message)
    if (!retryable) {
      await reportError('reseed-job-failed', error, {
        jobId, campaignId: job.campaignId, attempts: job.attempts,
      })
      if (job.releasesPlayLock) {
        await clearPendingWorldSeed(job.campaignId).catch(e =>
          console.error('Failed to clear pendingWorldSeed after failed reseed:', e)
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
  status: ReseedJobStatus
  attempts: number
  updatedAt: Date
  startedAt: Date | null
}

export type RecoveryDecision = 'kick' | 'reset_and_kick' | 'fail' | 'wait'

/** Pure: what to do with one live job during a recovery sweep. */
export function classifyStaleReseedJob(job: JobForRecovery, nowMs: number): RecoveryDecision {
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
 * Best-effort recovery of this campaign's stuck reseed jobs, piggybacked
 * on the admin lore/reseed GET (an admin watching a stuck reseed is the
 * retry loop). Never throws.
 */
export async function recoverStaleReseedJobs(campaignId: string): Promise<void> {
  try {
    const live = await prisma.reseedJob.findMany({
      where: { campaignId, status: { in: ['PENDING', 'RUNNING'] } },
      select: { id: true, status: true, attempts: true, updatedAt: true, startedAt: true, releasesPlayLock: true },
      take: 5,
    })
    const now = Date.now()

    for (const job of live) {
      const decision = classifyStaleReseedJob(job, now)
      if (decision === 'wait') continue

      if (decision === 'fail') {
        await prisma.reseedJob.update({
          where: { id: job.id },
          data: { status: 'FAILED', finishedAt: new Date(), lastError: 'Abandoned after repeated stalls' },
        })
        console.warn(`⚠️ Reseed job ${job.id} abandoned (stale RUNNING, out of attempts)`)
        await reportError('reseed-job-abandoned', new Error('Stale RUNNING job out of attempts'), {
          jobId: job.id, campaignId,
        })
        if (job.releasesPlayLock) {
          await clearPendingWorldSeed(campaignId).catch(e =>
            console.error('Failed to clear pendingWorldSeed after abandoned reseed:', e)
          )
        }
        continue
      }

      if (decision === 'reset_and_kick') {
        const reset = await prisma.reseedJob.updateMany({
          where: { id: job.id, status: 'RUNNING' },
          data: { status: 'PENDING' },
        })
        if (reset.count === 0) continue
        console.warn(`🔁 Reseed job ${job.id} reset from stale RUNNING`)
      }

      await kickReseedJob(job.id)
    }
  } catch (error) {
    console.error('Stale reseed job recovery failed (non-critical):', error)
  }
}

/**
 * Global counterpart to recoverStaleReseedJobs — see
 * resolutionQueue.sweepGloballyStuckResolutionJobs for why this exists
 * separately from the per-campaign sweep above.
 */
export async function sweepGloballyStuckReseedJobs(): Promise<void> {
  await alertStuckJobs(prisma.reseedJob as any, 'reseed-job-stuck')
}
