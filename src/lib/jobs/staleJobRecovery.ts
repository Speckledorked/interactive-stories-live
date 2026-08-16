// src/lib/jobs/staleJobRecovery.ts
// Shared "what to do with one live job during a recovery sweep" decision
// table, factored out of resolutionQueue.ts/imageGenQueue.ts/loreQueue.ts/
// reseedQueue.ts, which all independently reimplemented the identical
// PENDING/RUNNING staleness logic over an identical JobForRecovery shape
// (id/status/attempts/updatedAt/startedAt) and RecoveryDecision union.
//
// #413 — this file originally shared only the pure decision, on the
// reasoning that the sweep loops around it "differ in real ways per queue
// (extra selected fields, extra fail-path side effects like
// clearPendingWorldSeed) that would need leaky callback parameters to
// genuinely share". That reasoning was measured against the wrong cost.
// Five copies of the loop diverged instead: three of them (resolution,
// image, map) were byte-identical modulo a noun and a delegate, and the
// two that genuinely differ do so by exactly ONE extra select field and
// ONE post-abandon side effect. Two optional parameters is a cheaper
// abstraction than five bodies that each have to be fixed separately when
// the next #120-class bug shows up in the reset path.
//
// So `runStaleJobRecovery` below owns the loop, and each queue supplies
// what is actually its own: which model, which kick, what to call it in
// the logs, and (for lore/reseed) what else abandoning it releases.

import { reportError } from '@/lib/monitoring'

export interface JobForRecovery {
  id: string
  status: string
  attempts: number
  updatedAt: Date
  startedAt: Date | null
}

export type RecoveryDecision = 'kick' | 'reset_and_kick' | 'fail' | 'wait'

export interface StaleJobThresholds {
  pendingStaleMs: number
  runningStaleMs: number
  maxAttempts: number
}

/** Pure: what to do with one live job during a recovery sweep. */
export function classifyStaleJob(
  job: JobForRecovery,
  nowMs: number,
  { pendingStaleMs, runningStaleMs, maxAttempts }: StaleJobThresholds
): RecoveryDecision {
  if (job.status === 'PENDING') {
    return nowMs - job.updatedAt.getTime() >= pendingStaleMs ? 'kick' : 'wait'
  }
  if (job.status === 'RUNNING') {
    const startedMs = job.startedAt?.getTime() ?? job.updatedAt.getTime()
    if (nowMs - startedMs < runningStaleMs) return 'wait'
    return job.attempts >= maxAttempts ? 'fail' : 'reset_and_kick'
  }
  return 'wait'
}

/**
 * The slice of a Prisma job-model delegate this sweep touches.
 *
 * Args are `any` rather than the literal shapes used below, and that is
 * deliberate: Prisma generates a distinct `XWhereInput`/`XSelect` per model
 * with model-scoped status enums, so a structurally-typed signature is not
 * assignable from any real delegate — the parameter position is
 * contravariant and `status: { in: string[] }` never matches
 * `EnumResolutionJobStatusFilter<"SceneImage">`. The alternative is making
 * this function generic over five Prisma model types, which buys nothing:
 * the columns it reads are asserted by `JobForRecovery` on the way out, and
 * every call site passes a real delegate. Same trade `alertStuckJobs`
 * already makes.
 */
interface RecoverableJobModel {
  findMany(args: any): Promise<unknown[]>
  update(args: any): Promise<unknown>
  updateMany(args: any): Promise<{ count: number }>
}

export interface StaleJobRecoveryConfig<J extends JobForRecovery> {
  model: RecoverableJobModel
  thresholds: StaleJobThresholds
  /** Sentence-case noun for the console lines, e.g. `'Resolution job'`. */
  label: string
  /** `reportError` context for the abandon path, e.g. `'map-gen-job-abandoned'`. */
  abandonContext: string
  /** Re-kick a job the sweep decided is recoverable. */
  kick(jobId: string): Promise<void>
  /** Extra columns this queue's `onAbandon` needs. Merged into the select. */
  extraSelect?: Record<string, boolean>
  /**
   * Anything else abandoning this job must release — loreQueue clears the
   * campaign's pendingWorldSeed play lock here. Failures are logged, not
   * thrown: recovery is best-effort by contract.
   */
  onAbandon?(job: J): Promise<void>
}

/** How many of a campaign's live jobs one traffic-driven sweep looks at. */
const SWEEP_BATCH = 5

/**
 * Best-effort recovery of one campaign's stuck jobs, piggybacked on the
 * traffic that is already watching them (a player refreshing a stuck scene,
 * an admin watching a stuck import — that IS the retry loop). Never throws:
 * this runs inside GET handlers whose actual job is to return a page.
 */
export async function runStaleJobRecovery<J extends JobForRecovery>(
  campaignId: string,
  config: StaleJobRecoveryConfig<J>
): Promise<void> {
  const { model, thresholds, label, abandonContext, kick, extraSelect, onAbandon } = config

  try {
    const live = (await model.findMany({
      where: { campaignId, status: { in: ['PENDING', 'RUNNING'] } },
      select: { id: true, status: true, attempts: true, updatedAt: true, startedAt: true, ...extraSelect },
      take: SWEEP_BATCH,
    })) as J[]
    const now = Date.now()

    for (const job of live) {
      const decision = classifyStaleJob(job, now, thresholds)
      if (decision === 'wait') continue

      if (decision === 'fail') {
        await model.update({
          where: { id: job.id },
          data: { status: 'FAILED', finishedAt: new Date(), lastError: 'Abandoned after repeated stalls' },
        })
        console.warn(`⚠️ ${label} ${job.id} abandoned (stale RUNNING, out of attempts)`)
        await reportError(abandonContext, new Error('Stale RUNNING job out of attempts'), {
          jobId: job.id,
          campaignId,
        })
        if (onAbandon) {
          await onAbandon(job).catch((error) =>
            console.error(`Post-abandon cleanup failed for ${label} ${job.id}:`, error)
          )
        }
        continue
      }

      if (decision === 'reset_and_kick') {
        // Atomic: only reset if it's still the same stuck RUNNING row, so a
        // worker that woke up between the read and the write keeps its claim.
        const reset = await model.updateMany({
          where: { id: job.id, status: 'RUNNING' },
          data: { status: 'PENDING' },
        })
        if (reset.count === 0) continue
        console.warn(`🔁 ${label} ${job.id} reset from stale RUNNING`)
      }

      await kick(job.id)
    }
  } catch (error) {
    console.error(`Stale job recovery failed for ${label} (non-critical):`, error)
  }
}
