// src/lib/game/imageGenQueue.ts
// #96: async scene illustration. Copies resolutionQueue.ts's hardened
// job pattern (including both of its #120 fixes from day one, rather than
// re-discovering them as a future bug on a second file) — atomic claim,
// self-fetch kick with a non-OK-response fallback, opportunistic
// traffic-piggybacked recovery, global stuck-job alerting. SceneImage
// combines job-tracking and the final artifact in one row (see its schema
// comment), so there's no separate "job" vs "result" split the way
// ResolutionJob/Scene have.
//
// Recovery model: same as resolutionQueue.ts — no cron on this deployment
// target, so stuck jobs are recovered opportunistically by player traffic
// (the scene GET route calls recoverStaleImageJobs() best-effort).

import { prisma } from '@/lib/prisma'
import { ResolutionJobStatus } from '@prisma/client'
import { reportError } from '@/lib/monitoring'
import { alertStuckJobs } from '@/lib/jobs/stuckJobAlert'
import { kickInternalWorker } from '@/lib/jobs/kickInternalWorker'
import { classifyStaleJob as classifyStaleJobCore } from '@/lib/jobs/staleJobRecovery'
import PusherServer from '@/lib/realtime/pusher-server'

export const MAX_ATTEMPTS = 3
// Image generation is one API call + one upload — far shorter than the
// ~150s+ narrative pipeline resolutionQueue.ts budgets 6 minutes for.
export const RUNNING_STALE_MS = 3 * 60 * 1000
// Same reasoning as resolutionQueue.ts: a PENDING job should be picked up
// within seconds of its kick; this old means the kick was lost.
export const PENDING_STALE_MS = 45 * 1000

export interface EnqueueResult {
  jobId: string
  deduped: boolean
}

/**
 * Create (or reuse) the SceneImage row for a scene and kick the worker.
 * One row per scene (the schema's @@unique([sceneId])), so this looks up
 * by that unique key rather than just PENDING/RUNNING — a second call for
 * a scene whose row is already COMPLETED or FAILED would otherwise hit
 * the unique constraint on `create()` (this was a real, previously
 * unreachable gap: the automatic first-exchange trigger only ever calls
 * this once per scene, but a manual retry/backfill trigger calls it again
 * for exactly the scenes most likely to already have a FAILED row).
 * PENDING/RUNNING/COMPLETED all dedupe onto the existing row; FAILED
 * resets for a fresh retry instead of colliding.
 */
export async function enqueueSceneImageGeneration(
  campaignId: string,
  sceneId: string,
  prompt: string
): Promise<EnqueueResult> {
  const existing = await prisma.sceneImage.findUnique({
    where: { sceneId },
    select: { id: true, status: true },
  })

  if (existing && existing.status !== 'FAILED') {
    return { jobId: existing.id, deduped: true }
  }

  if (existing) {
    const job = await prisma.sceneImage.update({
      where: { id: existing.id },
      data: { status: 'PENDING', prompt, attempts: 0, lastError: null, finishedAt: null, imageUrl: null },
    })
    await kickImageJob(job.id)
    return { jobId: job.id, deduped: false }
  }

  const job = await prisma.sceneImage.create({
    data: { campaignId, sceneId, prompt },
  })
  await kickImageJob(job.id)
  return { jobId: job.id, deduped: false }
}

/**
 * Hand the job to its own invocation via the internal worker route. See
 * kickInternalWorker.ts for the delivery/fallback mechanics (both the
 * abort-on-delivery and the non-OK-response fallback are carried over
 * unchanged from resolutionQueue.ts's original kickJob).
 */
export async function kickImageJob(jobId: string): Promise<void> {
  await kickInternalWorker('/api/internal/generate-scene-image', { jobId }, () => processImageGenJob(jobId))
}

export interface ProcessResult {
  status: 'completed' | 'failed' | 'retry_scheduled' | 'skipped'
  error?: string
}

/**
 * Run one image-generation job to completion. Atomic claim (PENDING →
 * RUNNING) means concurrent kicks and recovery sweeps can all call this
 * safely — only one caller wins.
 */
export async function processImageGenJob(jobId: string): Promise<ProcessResult> {
  const claimed = await prisma.sceneImage.updateMany({
    where: { id: jobId, status: 'PENDING' },
    data: { status: 'RUNNING', startedAt: new Date(), attempts: { increment: 1 } },
  })
  if (claimed.count === 0) {
    return { status: 'skipped' }
  }

  // Same #120-derived guard resolutionQueue.ts has: a failure reading the
  // just-claimed row back must not leave it stranded RUNNING.
  let job: Awaited<ReturnType<typeof prisma.sceneImage.findUnique>>
  try {
    job = await prisma.sceneImage.findUnique({ where: { id: jobId } })
  } catch (error) {
    console.error(`Failed to read back claimed image job ${jobId}:`, error)
    await prisma.sceneImage.update({ where: { id: jobId }, data: { status: 'PENDING' } }).catch(e => console.error('Failed to revert stranded claim:', e))
    return { status: 'retry_scheduled', error: error instanceof Error ? error.message : String(error) }
  }
  if (!job) return { status: 'skipped' }

  if (!job.prompt) {
    // Never set by enqueueSceneImageGeneration in practice — a null prompt
    // means something upstream is broken, and retrying won't fix it.
    await prisma.sceneImage.update({
      where: { id: jobId },
      data: { status: 'FAILED', finishedAt: new Date(), lastError: 'No prompt was set for this image job' },
    }).catch(e => console.error('Failed to record job failure:', e))
    return { status: 'failed', error: 'No prompt was set for this image job' }
  }

  try {
    const { generateSceneImage } = await import('../ai/imageGeneration')
    const { uploadSceneImage } = await import('../blob/sceneImageStorage')

    const { imageBuffer, contentType } = await generateSceneImage(job.campaignId, job.sceneId, job.prompt)
    const imageUrl = await uploadSceneImage(job.sceneId, imageBuffer, contentType)

    await prisma.sceneImage.update({
      where: { id: jobId },
      data: { status: 'COMPLETED', finishedAt: new Date(), lastError: null, imageUrl },
    })

    try {
      const pusher = PusherServer()
      if (pusher) {
        await pusher.trigger(`campaign-${job.campaignId}`, 'scene:image-ready', { sceneId: job.sceneId, imageUrl })
      }
    } catch (pusherError) {
      console.error('Failed to broadcast scene:image-ready:', pusherError)
      // Never fail the job over a broadcast failure — the image is real
      // and saved; the client just needs to refetch to see it.
    }

    console.log(`✅ Image job ${jobId} completed`)
    return { status: 'completed' }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const retryable = job.attempts < MAX_ATTEMPTS
    await prisma.sceneImage.update({
      where: { id: jobId },
      data: {
        status: retryable ? 'PENDING' : 'FAILED',
        lastError: message.slice(0, 1000),
        ...(retryable ? {} : { finishedAt: new Date() }),
      },
    }).catch(e => console.error('Failed to record job failure:', e))
    console.error(`❌ Image job ${jobId} attempt ${job.attempts} failed:`, message)
    if (!retryable) {
      await reportError('scene-image-job-failed', error, {
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

/** Pure: what to do with one live image job during a recovery sweep. */
export function classifyStaleImageJob(job: JobForRecovery, nowMs: number): RecoveryDecision {
  return classifyStaleJobCore(job, nowMs, {
    pendingStaleMs: PENDING_STALE_MS,
    runningStaleMs: RUNNING_STALE_MS,
    maxAttempts: MAX_ATTEMPTS,
  })
}

/**
 * Best-effort recovery of this campaign's stuck image jobs, piggybacked on
 * scene GET traffic. Never throws.
 */
export async function recoverStaleImageJobs(campaignId: string): Promise<void> {
  try {
    const live = await prisma.sceneImage.findMany({
      where: { campaignId, status: { in: ['PENDING', 'RUNNING'] } },
      select: { id: true, status: true, attempts: true, updatedAt: true, startedAt: true },
      take: 5,
    })
    const now = Date.now()

    for (const job of live) {
      const decision = classifyStaleImageJob(job, now)
      if (decision === 'wait') continue

      if (decision === 'fail') {
        await prisma.sceneImage.update({
          where: { id: job.id },
          data: { status: 'FAILED', finishedAt: new Date(), lastError: 'Abandoned after repeated stalls' },
        })
        console.warn(`⚠️ Image job ${job.id} abandoned (stale RUNNING, out of attempts)`)
        await reportError('scene-image-job-abandoned', new Error('Stale RUNNING image job out of attempts'), {
          jobId: job.id, campaignId,
        })
        continue
      }

      if (decision === 'reset_and_kick') {
        const reset = await prisma.sceneImage.updateMany({
          where: { id: job.id, status: 'RUNNING' },
          data: { status: 'PENDING' },
        })
        if (reset.count === 0) continue
        console.warn(`🔁 Image job ${job.id} reset from stale RUNNING`)
      }

      await kickImageJob(job.id)
    }
  } catch (error) {
    console.error('Stale image job recovery failed (non-critical):', error)
  }
}

/**
 * Global counterpart to recoverStaleImageJobs — scans across ALL
 * campaigns for a job stuck in a campaign nobody is currently looking at,
 * piggybacked on the internal worker route so it runs on any real app usage.
 */
export async function sweepGloballyStuckImageJobs(): Promise<void> {
  await alertStuckJobs(prisma.sceneImage as any, 'scene-image-job-stuck')
}
