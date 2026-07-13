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
import { getJwtSecret } from '@/lib/auth'
import { reportError } from '@/lib/monitoring'
import { chargeForSceneResolution, BillingResult } from './resolutionBilling'

export const MAX_ATTEMPTS = 3
// A RUNNING job older than this is presumed dead (resolveScene's own
// internal timeout is 150s; world turn adds more — 6 minutes is generous).
export const RUNNING_STALE_MS = 6 * 60 * 1000
// A PENDING job should be picked up within seconds of its kick; one this
// old means the kick was lost (network blip, cold start failure).
export const PENDING_STALE_MS = 45 * 1000
// How long the enqueuing request waits for the worker invocation to be
// delivered before letting go — delivery is what matters, not completion.
const KICK_DELIVERY_TIMEOUT_MS = 3000

function baseUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return 'http://localhost:3000'
}

export function internalJobSecret(): string {
  // Falls back to the JWT secret, which itself refuses to run in
  // production without a real value (see lib/auth.ts) — no hardcoded
  // fallback can reach production either way.
  return process.env.INTERNAL_JOB_SECRET || getJwtSecret()
}

export interface EnqueueResult {
  jobId: string
  deduped: boolean
  // Present only when a charge was attempted (i.e. a genuinely new job
  // was about to be created). Absent on dedupe — a resolution already
  // in flight was already billed once when IT was created.
  billing?: BillingResult
}

/**
 * Create (or reuse) the resolution job for a scene, billing the players
 * it serves, and kick the worker. One live job per scene: if a
 * PENDING/RUNNING job already exists, this is a no-op returning it —
 * double-submits and racing players collapse onto the same job and are
 * not charged again.
 *
 * Billing runs here — the one call site both the auto-resolve paths
 * (scene/route.ts) and the admin manual-resolve route funnel through —
 * so "pay per scene resolution" applies uniformly regardless of what
 * triggered it. See resolutionBilling.ts. A failed charge (insufficient
 * balance) stops here: no job is created, nothing is billed, and the
 * caller is expected to surface `billing.details` to whoever triggered
 * the resolution.
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

  const billing = await chargeForSceneResolution(campaignId, sceneId)
  if (!billing.ok) {
    return { jobId: '', deduped: false, billing }
  }

  const job = await prisma.resolutionJob.create({
    data: { campaignId, sceneId },
  })
  await kickJob(job.id)
  return { jobId: job.id, deduped: false, billing }
}

/**
 * Hand the job to its own invocation via the internal worker route.
 * Awaited only long enough to deliver the request — the worker's
 * invocation has its own lifetime and keeps running after we stop
 * listening. If delivery itself fails (local dev without a reachable
 * self-URL, network error), fall back to processing inline: slower and
 * timeout-prone, but never silently dropped.
 */
export async function kickJob(jobId: string): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), KICK_DELIVERY_TIMEOUT_MS)
  try {
    await fetch(`${baseUrl()}/api/internal/resolve-job`, {
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
      // Delivered; we just stopped waiting for the (long) response.
      return
    }
    console.error('Job kick failed — falling back to inline processing:', error)
    await processResolutionJob(jobId)
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

  const job = await prisma.resolutionJob.findUnique({ where: { id: jobId } })
  if (!job) return { status: 'skipped' }

  try {
    const { resolveScene } = await import('./sceneResolver')
    const { runWorldTurn } = await import('./worldTurn')

    await resolveScene(job.campaignId, job.sceneId)
    await runWorldTurn(job.campaignId)

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
 * Best-effort recovery of this campaign's stuck jobs, piggybacked on
 * scene GET traffic (players staring at a stuck scene are refreshing —
 * that's the retry loop). Never throws.
 */
export async function recoverStaleJobs(campaignId: string): Promise<void> {
  try {
    const live = await prisma.resolutionJob.findMany({
      where: { campaignId, status: { in: ['PENDING', 'RUNNING'] } },
      select: { id: true, status: true, attempts: true, updatedAt: true, startedAt: true },
      take: 5,
    })
    const now = Date.now()

    for (const job of live) {
      const decision = classifyStaleJob(job, now)
      if (decision === 'wait') continue

      if (decision === 'fail') {
        await prisma.resolutionJob.update({
          where: { id: job.id },
          data: { status: 'FAILED', finishedAt: new Date(), lastError: 'Abandoned after repeated stalls' },
        })
        console.warn(`⚠️ Resolution job ${job.id} abandoned (stale RUNNING, out of attempts)`)
        await reportError('resolution-job-abandoned', new Error('Stale RUNNING job out of attempts'), {
          jobId: job.id, campaignId,
        })
        continue
      }

      if (decision === 'reset_and_kick') {
        // Atomic: only reset if it's still the same stuck RUNNING row.
        const reset = await prisma.resolutionJob.updateMany({
          where: { id: job.id, status: 'RUNNING' },
          data: { status: 'PENDING' },
        })
        if (reset.count === 0) continue
        console.warn(`🔁 Resolution job ${job.id} reset from stale RUNNING`)
      }

      await kickJob(job.id)
    }
  } catch (error) {
    console.error('Stale job recovery failed (non-critical):', error)
  }
}
