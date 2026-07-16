// src/lib/jobs/__tests__/stuckJobAlert.test.ts
// Pure gate for the global stuck-job alert sweep.

import { describe, it, expect } from 'vitest'
import { isStuckPastAlertThreshold, ALERT_THRESHOLD_MS, StuckJobCandidate } from '../stuckJobAlert'

describe('isStuckPastAlertThreshold', () => {
  const now = 1_700_000_000_000

  it('never fires for a completed/failed job', () => {
    const job: StuckJobCandidate = {
      id: '1', status: 'COMPLETED', updatedAt: new Date(now - ALERT_THRESHOLD_MS * 10), startedAt: null, alertedStuckAt: null,
    }
    expect(isStuckPastAlertThreshold(job, now)).toBe(false)
  })

  it('never fires twice — already-alerted jobs are skipped', () => {
    const job: StuckJobCandidate = {
      id: '1', status: 'RUNNING', updatedAt: new Date(now - ALERT_THRESHOLD_MS * 10),
      startedAt: new Date(now - ALERT_THRESHOLD_MS * 10), alertedStuckAt: new Date(now - 1000),
    }
    expect(isStuckPastAlertThreshold(job, now)).toBe(false)
  })

  it('does not fire for a PENDING job still within the threshold', () => {
    const job: StuckJobCandidate = {
      id: '1', status: 'PENDING', updatedAt: new Date(now - 1000), startedAt: null, alertedStuckAt: null,
    }
    expect(isStuckPastAlertThreshold(job, now)).toBe(false)
  })

  it('fires for a PENDING job stuck past the threshold', () => {
    const job: StuckJobCandidate = {
      id: '1', status: 'PENDING', updatedAt: new Date(now - ALERT_THRESHOLD_MS - 1000), startedAt: null, alertedStuckAt: null,
    }
    expect(isStuckPastAlertThreshold(job, now)).toBe(true)
  })

  it('uses startedAt (not updatedAt) as the clock for a RUNNING job', () => {
    const job: StuckJobCandidate = {
      id: '1', status: 'RUNNING',
      updatedAt: new Date(now - 1000), // recently touched (e.g. an attempt increment)
      startedAt: new Date(now - ALERT_THRESHOLD_MS - 1000), // but started long ago
      alertedStuckAt: null,
    }
    expect(isStuckPastAlertThreshold(job, now)).toBe(true)
  })

  it('falls back to updatedAt for a RUNNING job with no startedAt', () => {
    const job: StuckJobCandidate = {
      id: '1', status: 'RUNNING', updatedAt: new Date(now - ALERT_THRESHOLD_MS - 1000), startedAt: null, alertedStuckAt: null,
    }
    expect(isStuckPastAlertThreshold(job, now)).toBe(true)
  })
})
