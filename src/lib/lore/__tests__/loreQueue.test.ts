// src/lib/lore/__tests__/loreQueue.test.ts
// Mirrors resolutionQueue.test.ts: atomic claim semantics, retry
// bookkeeping, retry-clears-partial-entries, and pure stale-job recovery.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    loreImportJob: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn(),
    },
    loreEntry: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  },
}))
vi.mock('../loreImportService', () => ({
  runLoreImport: vi.fn(),
}))
vi.mock('@/lib/game/resolutionQueue', () => ({
  internalJobSecret: vi.fn().mockReturnValue('test-secret'),
}))

import { prisma } from '@/lib/prisma'
import { runLoreImport } from '../loreImportService'
import {
  processLoreImportJob,
  classifyStaleLoreJob,
  MAX_ATTEMPTS,
  RUNNING_STALE_MS,
  PENDING_STALE_MS,
} from '../loreQueue'

const db = prisma as any

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
})

describe('processLoreImportJob', () => {
  it('skips when the claim is lost (already RUNNING elsewhere)', async () => {
    db.loreImportJob.updateMany.mockResolvedValue({ count: 0 })
    const result = await processLoreImportJob('job1')
    expect(result.status).toBe('skipped')
    expect(runLoreImport).not.toHaveBeenCalled()
  })

  it('runs the import and completes on success', async () => {
    db.loreImportJob.updateMany.mockResolvedValue({ count: 1 })
    db.loreImportJob.findUnique.mockResolvedValue({
      id: 'job1', campaignId: 'camp1', sourceType: 'PASTE', attempts: 1,
    })

    const result = await processLoreImportJob('job1')

    expect(runLoreImport).toHaveBeenCalled()
    expect(db.loreImportJob.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED' }) })
    )
    expect(result.status).toBe('completed')
  })

  it('does not clear prior entries on a first attempt', async () => {
    db.loreImportJob.updateMany.mockResolvedValue({ count: 1 })
    db.loreImportJob.findUnique.mockResolvedValue({
      id: 'job1', campaignId: 'camp1', sourceType: 'PASTE', attempts: 1,
    })
    await processLoreImportJob('job1')
    expect(db.loreEntry.deleteMany).not.toHaveBeenCalled()
  })

  it('clears previously stored entries before a retry attempt', async () => {
    db.loreImportJob.updateMany.mockResolvedValue({ count: 1 })
    db.loreImportJob.findUnique.mockResolvedValue({
      id: 'job1', campaignId: 'camp1', sourceType: 'WIKI', attempts: 2,
    })
    await processLoreImportJob('job1')
    expect(db.loreEntry.deleteMany).toHaveBeenCalledWith({ where: { jobId: 'job1' } })
  })

  it('returns the job to PENDING on failure while attempts remain', async () => {
    db.loreImportJob.updateMany.mockResolvedValue({ count: 1 })
    db.loreImportJob.findUnique.mockResolvedValue({
      id: 'job1', campaignId: 'camp1', sourceType: 'URL', attempts: 1,
    })
    ;(runLoreImport as any).mockRejectedValue(new Error('fetch failed'))

    const result = await processLoreImportJob('job1')

    expect(result.status).toBe('retry_scheduled')
    expect(db.loreImportJob.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PENDING', lastError: 'fetch failed' }) })
    )
  })

  it('fails terminally once attempts are exhausted', async () => {
    db.loreImportJob.updateMany.mockResolvedValue({ count: 1 })
    db.loreImportJob.findUnique.mockResolvedValue({
      id: 'job1', campaignId: 'camp1', sourceType: 'URL', attempts: MAX_ATTEMPTS,
    })
    ;(runLoreImport as any).mockRejectedValue(new Error('still broken'))

    const result = await processLoreImportJob('job1')

    expect(result.status).toBe('failed')
    expect(db.loreImportJob.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) })
    )
  })
})

describe('classifyStaleLoreJob (pure recovery decisions)', () => {
  const now = 1_000_000_000
  const job = (overrides: any) => ({
    id: 'j', status: 'PENDING', attempts: 1,
    updatedAt: new Date(now), startedAt: null, ...overrides,
  })

  it('waits on fresh jobs', () => {
    expect(classifyStaleLoreJob(job({}), now)).toBe('wait')
    expect(
      classifyStaleLoreJob(job({ status: 'RUNNING', startedAt: new Date(now - 1000) }), now)
    ).toBe('wait')
  })

  it('re-kicks a PENDING job whose kick was lost', () => {
    expect(
      classifyStaleLoreJob(job({ updatedAt: new Date(now - PENDING_STALE_MS - 1) }), now)
    ).toBe('kick')
  })

  it('resets a crashed RUNNING job while attempts remain', () => {
    expect(
      classifyStaleLoreJob(
        job({ status: 'RUNNING', startedAt: new Date(now - RUNNING_STALE_MS - 1), attempts: 1 }),
        now
      )
    ).toBe('reset_and_kick')
  })

  it('abandons a stale RUNNING job out of attempts', () => {
    expect(
      classifyStaleLoreJob(
        job({ status: 'RUNNING', startedAt: new Date(now - RUNNING_STALE_MS - 1), attempts: MAX_ATTEMPTS }),
        now
      )
    ).toBe('fail')
  })
})
