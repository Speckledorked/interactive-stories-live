// src/lib/game/__tests__/resolutionQueue.test.ts
// Async scene resolution: enqueue dedupe, atomic claim semantics, retry
// bookkeeping, and the pure stale-job recovery decisions.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    resolutionJob: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn(),
    },
  },
}))
vi.mock('../sceneResolver', () => ({
  resolveScene: vi.fn(),
  getCurrentScene: vi.fn(),
}))
vi.mock('../worldTurn', () => ({
  runWorldTurn: vi.fn(),
}))

import { prisma } from '@/lib/prisma'
import { resolveScene } from '../sceneResolver'
import { runWorldTurn } from '../worldTurn'
import {
  enqueueSceneResolution,
  processResolutionJob,
  classifyStaleJob,
  MAX_ATTEMPTS,
  RUNNING_STALE_MS,
  PENDING_STALE_MS,
} from '../resolutionQueue'

const db = prisma as any

beforeEach(() => {
  vi.clearAllMocks()
  // kickJob's fetch: pretend delivery succeeds instantly.
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
})

describe('enqueueSceneResolution', () => {
  it('dedupes onto an existing live job', async () => {
    db.resolutionJob.findFirst.mockResolvedValue({ id: 'job1' })
    const result = await enqueueSceneResolution('camp1', 'scene1')
    expect(result).toEqual({ jobId: 'job1', deduped: true })
    expect(db.resolutionJob.create).not.toHaveBeenCalled()
  })

  it('creates and kicks a new job when none is live', async () => {
    db.resolutionJob.findFirst.mockResolvedValue(null)
    db.resolutionJob.create.mockResolvedValue({ id: 'job2' })
    const result = await enqueueSceneResolution('camp1', 'scene1')
    expect(result).toEqual({ jobId: 'job2', deduped: false })
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/internal/resolve-job'),
      expect.objectContaining({ method: 'POST' })
    )
  })
})

describe('processResolutionJob', () => {
  it('skips when the claim is lost (already RUNNING elsewhere)', async () => {
    db.resolutionJob.updateMany.mockResolvedValue({ count: 0 })
    const result = await processResolutionJob('job1')
    expect(result.status).toBe('skipped')
    expect(resolveScene).not.toHaveBeenCalled()
  })

  it('runs the pipeline and completes on success', async () => {
    db.resolutionJob.updateMany.mockResolvedValue({ count: 1 })
    db.resolutionJob.findUnique.mockResolvedValue({
      id: 'job1', campaignId: 'camp1', sceneId: 'scene1', attempts: 1,
    })

    const result = await processResolutionJob('job1')

    expect(resolveScene).toHaveBeenCalledWith('camp1', 'scene1')
    expect(runWorldTurn).toHaveBeenCalledWith('camp1')
    expect(db.resolutionJob.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED' }) })
    )
    expect(result.status).toBe('completed')
  })

  it('returns the job to PENDING on failure while attempts remain', async () => {
    db.resolutionJob.updateMany.mockResolvedValue({ count: 1 })
    db.resolutionJob.findUnique.mockResolvedValue({
      id: 'job1', campaignId: 'camp1', sceneId: 'scene1', attempts: 1,
    })
    ;(resolveScene as any).mockRejectedValue(new Error('AI timeout'))

    const result = await processResolutionJob('job1')

    expect(result.status).toBe('retry_scheduled')
    expect(db.resolutionJob.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PENDING', lastError: 'AI timeout' }) })
    )
  })

  it('fails terminally once attempts are exhausted', async () => {
    db.resolutionJob.updateMany.mockResolvedValue({ count: 1 })
    db.resolutionJob.findUnique.mockResolvedValue({
      id: 'job1', campaignId: 'camp1', sceneId: 'scene1', attempts: MAX_ATTEMPTS,
    })
    ;(resolveScene as any).mockRejectedValue(new Error('still broken'))

    const result = await processResolutionJob('job1')

    expect(result.status).toBe('failed')
    expect(db.resolutionJob.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) })
    )
  })
})

describe('classifyStaleJob (pure recovery decisions)', () => {
  const now = 1_000_000_000
  const job = (overrides: any) => ({
    id: 'j', status: 'PENDING', attempts: 1,
    updatedAt: new Date(now), startedAt: null, ...overrides,
  })

  it('waits on fresh jobs', () => {
    expect(classifyStaleJob(job({}), now)).toBe('wait')
    expect(
      classifyStaleJob(job({ status: 'RUNNING', startedAt: new Date(now - 1000) }), now)
    ).toBe('wait')
  })

  it('re-kicks a PENDING job whose kick was lost', () => {
    expect(
      classifyStaleJob(job({ updatedAt: new Date(now - PENDING_STALE_MS - 1) }), now)
    ).toBe('kick')
  })

  it('resets a crashed RUNNING job while attempts remain', () => {
    expect(
      classifyStaleJob(
        job({ status: 'RUNNING', startedAt: new Date(now - RUNNING_STALE_MS - 1), attempts: 1 }),
        now
      )
    ).toBe('reset_and_kick')
  })

  it('abandons a stale RUNNING job out of attempts', () => {
    expect(
      classifyStaleJob(
        job({ status: 'RUNNING', startedAt: new Date(now - RUNNING_STALE_MS - 1), attempts: MAX_ATTEMPTS }),
        now
      )
    ).toBe('fail')
  })
})
