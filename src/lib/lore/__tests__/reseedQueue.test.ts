// src/lib/lore/__tests__/reseedQueue.test.ts
// Mirrors loreQueue.test.ts: atomic claim semantics, retry bookkeeping,
// play-lock release on terminal states, and pure stale-job recovery.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    reseedJob: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn(),
    },
  },
}))
vi.mock('../reseedWorld', () => ({
  reseedWorldFromLore: vi.fn(),
  clearPendingWorldSeed: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/game/resolutionQueue', () => ({
  internalJobSecret: vi.fn().mockReturnValue('test-secret'),
}))

import { prisma } from '@/lib/prisma'
import { reseedWorldFromLore, clearPendingWorldSeed } from '../reseedWorld'
import {
  processReseedJob,
  classifyStaleReseedJob,
  MAX_ATTEMPTS,
  RUNNING_STALE_MS,
  PENDING_STALE_MS,
} from '../reseedQueue'

const db = prisma as any

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
})

describe('processReseedJob', () => {
  it('skips when the claim is lost (already RUNNING elsewhere)', async () => {
    db.reseedJob.updateMany.mockResolvedValue({ count: 0 })
    const result = await processReseedJob('job1')
    expect(result.status).toBe('skipped')
    expect(reseedWorldFromLore).not.toHaveBeenCalled()
  })

  it('runs the reseed and completes on success, storing the summary', async () => {
    db.reseedJob.updateMany.mockResolvedValue({ count: 1 })
    db.reseedJob.findUnique.mockResolvedValue({
      id: 'job1', campaignId: 'camp1', attempts: 1, releasesPlayLock: false,
    })
    ;(reseedWorldFromLore as any).mockResolvedValue({ ok: true, summary: { fresh: true } } as any)

    const result = await processReseedJob('job1')

    expect(reseedWorldFromLore).toHaveBeenCalledWith('camp1')
    expect(db.reseedJob.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED', summary: { fresh: true } }) })
    )
    expect(clearPendingWorldSeed).not.toHaveBeenCalled()
    expect(result.status).toBe('completed')
  })

  it('releases the play lock on success when releasesPlayLock is set', async () => {
    db.reseedJob.updateMany.mockResolvedValue({ count: 1 })
    db.reseedJob.findUnique.mockResolvedValue({
      id: 'job1', campaignId: 'camp1', attempts: 1, releasesPlayLock: true,
    })
    ;(reseedWorldFromLore as any).mockResolvedValue({ ok: true, summary: {} } as any)

    await processReseedJob('job1')

    expect(clearPendingWorldSeed).toHaveBeenCalledWith('camp1')
  })

  it('marks FAILED (not retryable) when reseedWorldFromLore returns a clean non-ok result', async () => {
    db.reseedJob.updateMany.mockResolvedValue({ count: 1 })
    db.reseedJob.findUnique.mockResolvedValue({
      id: 'job1', campaignId: 'camp1', attempts: 1, releasesPlayLock: true,
    })
    ;(reseedWorldFromLore as any).mockResolvedValue({ ok: false, reason: 'no_lore' } as any)

    const result = await processReseedJob('job1')

    expect(result.status).toBe('failed')
    expect(db.reseedJob.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED', lastError: 'no_lore' }) })
    )
    expect(clearPendingWorldSeed).toHaveBeenCalledWith('camp1')
  })

  it('returns the job to PENDING on a thrown error while attempts remain', async () => {
    db.reseedJob.updateMany.mockResolvedValue({ count: 1 })
    db.reseedJob.findUnique.mockResolvedValue({
      id: 'job1', campaignId: 'camp1', attempts: 1, releasesPlayLock: false,
    })
    ;(reseedWorldFromLore as any).mockRejectedValue(new Error('AI call failed'))

    const result = await processReseedJob('job1')

    expect(result.status).toBe('retry_scheduled')
    expect(db.reseedJob.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PENDING', lastError: 'AI call failed' }) })
    )
  })

  it('fails terminally once attempts are exhausted and releases the play lock', async () => {
    db.reseedJob.updateMany.mockResolvedValue({ count: 1 })
    db.reseedJob.findUnique.mockResolvedValue({
      id: 'job1', campaignId: 'camp1', attempts: MAX_ATTEMPTS, releasesPlayLock: true,
    })
    ;(reseedWorldFromLore as any).mockRejectedValue(new Error('still broken'))

    const result = await processReseedJob('job1')

    expect(result.status).toBe('failed')
    expect(db.reseedJob.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) })
    )
    expect(clearPendingWorldSeed).toHaveBeenCalledWith('camp1')
  })
})

describe('classifyStaleReseedJob (pure recovery decisions)', () => {
  const now = 1_000_000_000
  const job = (overrides: any) => ({
    id: 'j', status: 'PENDING', attempts: 1,
    updatedAt: new Date(now), startedAt: null, ...overrides,
  })

  it('waits on fresh jobs', () => {
    expect(classifyStaleReseedJob(job({}), now)).toBe('wait')
    expect(
      classifyStaleReseedJob(job({ status: 'RUNNING', startedAt: new Date(now - 1000) }), now)
    ).toBe('wait')
  })

  it('re-kicks a PENDING job whose kick was lost', () => {
    expect(
      classifyStaleReseedJob(job({ updatedAt: new Date(now - PENDING_STALE_MS - 1) }), now)
    ).toBe('kick')
  })

  it('resets a crashed RUNNING job while attempts remain', () => {
    expect(
      classifyStaleReseedJob(
        job({ status: 'RUNNING', startedAt: new Date(now - RUNNING_STALE_MS - 1), attempts: 1 }),
        now
      )
    ).toBe('reset_and_kick')
  })

  it('abandons a stale RUNNING job out of attempts', () => {
    expect(
      classifyStaleReseedJob(
        job({ status: 'RUNNING', startedAt: new Date(now - RUNNING_STALE_MS - 1), attempts: MAX_ATTEMPTS }),
        now
      )
    ).toBe('fail')
  })
})
