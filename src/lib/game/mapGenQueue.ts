// src/lib/game/mapGenQueue.ts
// #291: async map generation. Copies imageGenQueue.ts's job pattern
// (itself copied from resolutionQueue.ts, including both of its #120
// fixes) — atomic claim, self-fetch kick with a non-OK-response fallback,
// opportunistic traffic-piggybacked recovery, global stuck-job alerting.
// MapGenerationJob only tracks the job's own lifecycle — the generated
// content itself (Map/Zone/Token rows) is written directly by
// AIVisualService.generateMapFromScene, same split SceneImage doesn't have
// (SceneImage's own artifact, imageUrl, IS a field on the job row) but
// ResolutionJob/Scene already does.
//
// Recovery model: same as imageGenQueue.ts — no cron on this deployment
// target, so stuck jobs are recovered opportunistically by player traffic
// (the scene GET route calls recoverStaleMapJobs() best-effort).

import { prisma } from '@/lib/prisma'
import { ResolutionJobStatus } from '@prisma/client'
import { reportError } from '@/lib/monitoring'
import { alertStuckJobs } from '@/lib/jobs/stuckJobAlert'
import { kickInternalWorker } from '@/lib/jobs/kickInternalWorker'
import { classifyStaleJob as classifyStaleJobCore, runStaleJobRecovery } from '@/lib/jobs/staleJobRecovery'
import PusherServer from '@/lib/realtime/pusher-server'

export const MAX_ATTEMPTS = 3
// One AI analysis call plus several sequential zone/token DB writes — no
// image generation/upload, so a similar order of magnitude to scene
// illustration's own budget.
export const RUNNING_STALE_MS = 3 * 60 * 1000
export const PENDING_STALE_MS = 45 * 1000

export interface EnqueueResult {
  jobId: string
  deduped: boolean
}

/**
 * Create (or reuse) the MapGenerationJob row for a scene and kick the
 * worker. One row per scene (the schema's @@unique([sceneId])) — same
 * dedupe-vs-reset-on-FAILED shape as enqueueSceneImageGeneration.
 */
export async function enqueueMapGeneration(
  campaignId: string,
  sceneId: string,
  sceneDescription: string,
  previousMapId?: string
): Promise<EnqueueResult> {
  const existing = await prisma.mapGenerationJob.findUnique({
    where: { sceneId },
    select: { id: true, status: true },
  })

  if (existing && existing.status !== 'FAILED') {
    return { jobId: existing.id, deduped: true }
  }

  if (existing) {
    const job = await prisma.mapGenerationJob.update({
      where: { id: existing.id },
      data: { status: 'PENDING', sceneDescription, previousMapId, attempts: 0, lastError: null, finishedAt: null },
    })
    await kickMapJob(job.id)
    return { jobId: job.id, deduped: false }
  }

  const job = await prisma.mapGenerationJob.create({
    data: { campaignId, sceneId, sceneDescription, previousMapId },
  })
  await kickMapJob(job.id)
  return { jobId: job.id, deduped: false }
}

/**
 * Hand the job to its own invocation via the internal worker route. See
 * kickInternalWorker.ts for the delivery/fallback mechanics.
 */
export async function kickMapJob(jobId: string): Promise<void> {
  await kickInternalWorker('/api/internal/generate-map', { jobId }, () => processMapGenJob(jobId))
}

export interface ProcessResult {
  status: 'completed' | 'failed' | 'retry_scheduled' | 'skipped'
  error?: string
}

/**
 * Run one map-generation job to completion. Atomic claim (PENDING →
 * RUNNING) means concurrent kicks and recovery sweeps can all call this
 * safely — only one caller wins.
 */
export async function processMapGenJob(jobId: string): Promise<ProcessResult> {
  const claimed = await prisma.mapGenerationJob.updateMany({
    where: { id: jobId, status: 'PENDING' },
    data: { status: 'RUNNING', startedAt: new Date(), attempts: { increment: 1 } },
  })
  if (claimed.count === 0) {
    return { status: 'skipped' }
  }

  // Same #120-derived guard resolutionQueue.ts/imageGenQueue.ts have: a
  // failure reading the just-claimed row back must not leave it stranded
  // RUNNING.
  let job: Awaited<ReturnType<typeof prisma.mapGenerationJob.findUnique>>
  try {
    job = await prisma.mapGenerationJob.findUnique({ where: { id: jobId } })
  } catch (error) {
    console.error(`Failed to read back claimed map job ${jobId}:`, error)
    await prisma.mapGenerationJob.update({ where: { id: jobId }, data: { status: 'PENDING' } }).catch(e => console.error('Failed to revert stranded claim:', e))
    return { status: 'retry_scheduled', error: error instanceof Error ? error.message : String(error) }
  }
  if (!job) return { status: 'skipped' }

  if (!job.sceneDescription) {
    // Never set by enqueueMapGeneration in practice — an empty description
    // means something upstream is broken, and retrying won't fix it.
    await prisma.mapGenerationJob.update({
      where: { id: jobId },
      data: { status: 'FAILED', finishedAt: new Date(), lastError: 'No scene description was set for this map job' },
    }).catch(e => console.error('Failed to record job failure:', e))
    return { status: 'failed', error: 'No scene description was set for this map job' }
  }

  try {
    const { AIVisualService } = await import('../ai/ai-visual-service')
    const { MapService } = await import('../maps/map-service')

    const visual = await AIVisualService.generateMapFromScene(
      job.sceneDescription,
      job.campaignId,
      job.previousMapId ?? undefined
    )

    await prisma.mapGenerationJob.update({
      where: { id: jobId },
      data: { status: 'COMPLETED', finishedAt: new Date(), lastError: null },
    })

    // Bound accumulation: generation creates a fresh Map+Zone+Token set
    // whenever the AI decides a scene isn't reusing a location, and
    // nothing else removes old ones.
    const pruned = await MapService.pruneOldMaps(job.campaignId)
    if (pruned > 0) {
      console.log(`🗺️  Pruned ${pruned} old map(s) past the per-campaign cap`)
    }

    try {
      const pusher = PusherServer()
      if (pusher) {
        await pusher.trigger(`campaign-${job.campaignId}`, 'map:ready', { sceneId: job.sceneId, mapId: visual.mapId })
      }
    } catch (pusherError) {
      console.error('Failed to broadcast map:ready:', pusherError)
      // Never fail the job over a broadcast failure — the map is real and
      // saved; the client just needs to refetch to see it.
    }

    console.log(`✅ Map job ${jobId} completed`)
    return { status: 'completed' }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const retryable = job.attempts < MAX_ATTEMPTS
    await prisma.mapGenerationJob.update({
      where: { id: jobId },
      data: {
        status: retryable ? 'PENDING' : 'FAILED',
        lastError: message.slice(0, 1000),
        ...(retryable ? {} : { finishedAt: new Date() }),
      },
    }).catch(e => console.error('Failed to record job failure:', e))
    console.error(`❌ Map job ${jobId} attempt ${job.attempts} failed:`, message)
    if (!retryable) {
      await reportError('map-gen-job-failed', error, {
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

/** Pure: what to do with one live map job during a recovery sweep. */
export function classifyStaleMapJob(job: JobForRecovery, nowMs: number): RecoveryDecision {
  return classifyStaleJobCore(job, nowMs, {
    pendingStaleMs: PENDING_STALE_MS,
    runningStaleMs: RUNNING_STALE_MS,
    maxAttempts: MAX_ATTEMPTS,
  })
}

/**
 * Best-effort recovery of this campaign's stuck map jobs, piggybacked on
 * scene GET traffic. Never throws.
 */
export async function recoverStaleMapJobs(campaignId: string): Promise<void> {
  await runStaleJobRecovery(campaignId, {
    model: prisma.mapGenerationJob,
    thresholds: { pendingStaleMs: PENDING_STALE_MS, runningStaleMs: RUNNING_STALE_MS, maxAttempts: MAX_ATTEMPTS },
    label: 'Map job',
    abandonContext: 'map-gen-job-abandoned',
    kick: kickMapJob,
  })
}

/**
 * Global counterpart to recoverStaleMapJobs — scans across ALL campaigns
 * for a job stuck in a campaign nobody is currently looking at, piggybacked
 * on the internal worker route so it runs on any real app usage.
 */
export async function sweepGloballyStuckMapJobs(): Promise<void> {
  await alertStuckJobs(prisma.mapGenerationJob as any, 'map-gen-job-stuck')
}
