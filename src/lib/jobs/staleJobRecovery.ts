// src/lib/jobs/staleJobRecovery.ts
// Shared "what to do with one live job during a recovery sweep" decision
// table, factored out of resolutionQueue.ts/imageGenQueue.ts/loreQueue.ts/
// reseedQueue.ts, which all independently reimplemented the identical
// PENDING/RUNNING staleness logic over an identical JobForRecovery shape
// (id/status/attempts/updatedAt/startedAt) and RecoveryDecision union.
//
// Deliberately does NOT unify the DB-touching recoverStaleXJobs sweep
// loops themselves — those differ in real ways per queue (extra selected
// fields, extra fail-path side effects like clearPendingWorldSeed) that
// would need leaky callback parameters to genuinely share. Only the pure
// decision this function makes is actually duplicated; the orchestration
// around it isn't.

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
