// src/lib/game/resolutionQueue.ts
// Async scene resolution: takes the ~150s AI-GM-plus-world-turn pipeline
// off the request path. Action submission enqueues a ResolutionJob and
// returns immediately; the job runs in its own invocation (the internal
// worker route, self-invoked over HTTP), and the UI follows along via the
// Pusher events resolveScene already broadcasts.
//
// Recovery model: there is no cron on this deployment target, so stuck
// jobs are recovered opportunistically by player traffic — the scene GET
// route calls recoverStaleJobs() best-effort. A lost kick re-kicks, a
// crashed RUNNING job returns to PENDING (up to MAX_ATTEMPTS), and the
// scene itself is always retryable because resolveScene reverts scene
// status on failure.

import { prisma } from '@/lib/prisma'
import { ResolutionJobStatus } from '@prisma/client'
import { reportError } from '@/lib/monitoring'
import { alertStuckJobs } from '@/lib/jobs/stuckJobAlert'
import { kickInternalWorker, internalJobSecret } from '@/lib/jobs/kickInternalWorker'
import { classifyStaleJob as classifyStaleJobCore, runStaleJobRecovery } from '@/lib/jobs/staleJobRecovery'

// Re-exported for the many call sites that already import this from here
// (the internal-worker routes, the other job queues) — canonical home is
// now kickInternalWorker.ts, alongside the fetch mechanics that use it.
export { internalJobSecret }

export const MAX_ATTEMPTS = 3
// A RUNNING job older than this is presumed dead (resolveScene's own
// internal timeout is 150s; world turn adds more — 6 minutes is generous).
export const RUNNING_STALE_MS = 6 * 60 * 1000
// A PENDING job should be picked up within seconds of its kick; one this
// old means the kick was lost (network blip, cold start failure).
export const PENDING_STALE_MS = 45 * 1000

export interface EnqueueResult {
  jobId: string
  deduped: boolean
}

/**
 * Create (or reuse) the resolution job for a scene and kick the worker.
 * One live job per scene: if a PENDING/RUNNING job already exists, this
 * is a no-op returning it — double-submits and racing players collapse
 * onto the same job.
 *
 * No billing happens here — a scene can go through many free mid-scene
 * resolutions (the GM narrating each action) before it's billed exactly
 * once, when it actually ends. See end-scene/route.ts and
 * resolutionBilling.ts.
 */
export async function enqueueSceneResolution(
  campaignId: string,
  sceneId: string
): Promise<EnqueueResult> {
  const existing = await prisma.resolutionJob.findFirst({
    where: { sceneId, status: { in: ['PENDING', 'RUNNING'] } },
    select: { id: true },
  })
  if (existing) {
    return { jobId: existing.id, deduped: true }
  }

  const job = await prisma.resolutionJob.create({
    data: { campaignId, sceneId },
  })
  await kickJob(job.id)
  return { jobId: job.id, deduped: false }
}

/**
 * Hand the job to its own invocation via the internal worker route. See
 * kickInternalWorker.ts for the delivery/fallback mechanics — a non-OK
 * response or a failed delivery here falls back to processResolutionJob
 * inline (#120), since either means the job was never actually handed off
 * and its `attempts` counter never incremented.
 */
export async function kickJob(jobId: string): Promise<void> {
  await kickInternalWorker('/api/internal/resolve-job', { jobId }, () => processResolutionJob(jobId))
}

export interface ProcessResult {
  status: 'completed' | 'failed' | 'retry_scheduled' | 'skipped'
  error?: string
}

/**
 * Run one job to completion. Atomic claim (PENDING → RUNNING) means
 * concurrent kicks and recovery sweeps can all call this safely — only
 * one caller wins. On failure the job returns to PENDING while attempts
 * remain (recovery traffic re-kicks it), else FAILED. Scene-state safety
 * is resolveScene's own job: it reverts the scene to AWAITING_ACTIONS
 * and broadcasts scene:resolution-failed internally.
 */
export async function processResolutionJob(jobId: string): Promise<ProcessResult> {
  const claimed = await prisma.resolutionJob.updateMany({
    where: { id: jobId, status: 'PENDING' },
    data: { status: 'RUNNING', startedAt: new Date(), attempts: { increment: 1 } },
  })
  if (claimed.count === 0) {
    return { status: 'skipped' }
  }

  // The claim above already flipped this row to RUNNING. A failure reading
  // it back (a transient DB blip, not a missing row) must not leave that
  // claimed row stranded — with no catch here it would sit RUNNING,
  // unexplained, for a full RUNNING_STALE_MS before recovery even notices
  // it (#120). Best-effort revert to PENDING so ordinary recovery retries
  // it immediately instead.
  let job: Awaited<ReturnType<typeof prisma.resolutionJob.findUnique>>
  try {
    job = await prisma.resolutionJob.findUnique({ where: { id: jobId } })
  } catch (error) {
    console.error(`Failed to read back claimed resolution job ${jobId}:`, error)
    await prisma.resolutionJob.update({ where: { id: jobId }, data: { status: 'PENDING' } }).catch(e => console.error('Failed to revert stranded claim:', e))
    return { status: 'retry_scheduled', error: error instanceof Error ? error.message : String(error) }
  }
  if (!job) return { status: 'skipped' }

  try {
    const { resolveScene } = await import('./sceneResolver')
    const { runWorldTurnIfDue } = await import('./worldTurn')

    await resolveScene(job.campaignId, job.sceneId)
    // Paced by in-game time: only runs when the fiction has actually
    // advanced far enough since the last world turn (see tick/pacing.ts).
    await runWorldTurnIfDue(job.campaignId)

    await prisma.resolutionJob.update({
      where: { id: jobId },
      data: { status: 'COMPLETED', finishedAt: new Date(), lastError: null },
    })
    console.log(`✅ Resolution job ${jobId} completed`)
    return { status: 'completed' }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const retryable = job.attempts < MAX_ATTEMPTS
    await prisma.resolutionJob.update({
      where: { id: jobId },
      data: {
        status: retryable ? 'PENDING' : 'FAILED',
        lastError: message.slice(0, 1000),
        ...(retryable ? {} : { finishedAt: new Date() }),
      },
    }).catch(e => console.error('Failed to record job failure:', e))
    console.error(`❌ Resolution job ${jobId} attempt ${job.attempts} failed:`, message)
    if (!retryable) {
      await reportError('resolution-job-failed', error, {
        jobId, campaignId: job.campaignId, sceneId: job.sceneId, attempts: job.attempts,
      })
    }
    return retryable ? { status: 'retry_scheduled', error: message } : { status: 'failed', error: message }
  }
}

// ---------------------------------------------------------------------------
// Opportunistic recovery (pure decision + traffic-driven sweep)
// ---------------------------------------------------------------------------

export interface JobForRecovery {
  id: string
  status: ResolutionJobStatus
  attempts: number
  updatedAt: Date
  startedAt: Date | null
}

export type RecoveryDecision = 'kick' | 'reset_and_kick' | 'fail' | 'wait'

/** Pure: what to do with one live job during a recovery sweep. */
export function classifyStaleJob(job: JobForRecovery, nowMs: number): RecoveryDecision {
  return classifyStaleJobCore(job, nowMs, {
    pendingStaleMs: PENDING_STALE_MS,
    runningStaleMs: RUNNING_STALE_MS,
    maxAttempts: MAX_ATTEMPTS,
  })
}

/**
 * Best-effort recovery of this campaign's stuck jobs, piggybacked on
 * scene GET traffic (players staring at a stuck scene are refreshing —
 * that's the retry loop). Never throws.
 */
export async function recoverStaleJobs(campaignId: string): Promise<void> {
  await runStaleJobRecovery(campaignId, {
    model: prisma.resolutionJob,
    thresholds: { pendingStaleMs: PENDING_STALE_MS, runningStaleMs: RUNNING_STALE_MS, maxAttempts: MAX_ATTEMPTS },
    label: 'Resolution job',
    abandonContext: 'resolution-job-abandoned',
    kick: kickJob,
  })
}

/**
 * Global counterpart to recoverStaleJobs: recovery above only looks at ONE
 * campaign's jobs and only runs when someone requests that campaign's
 * scene. A job stuck in a campaign nobody is currently looking at has no
 * traffic to trigger that — this scans across ALL campaigns and fires a
 * one-time alert (see lib/jobs/stuckJobAlert.ts), piggybacked on the
 * internal worker route so it runs on any real app usage.
 */
export async function sweepGloballyStuckResolutionJobs(): Promise<void> {
  await alertStuckJobs(prisma.resolutionJob as any, 'resolution-job-stuck')
}
