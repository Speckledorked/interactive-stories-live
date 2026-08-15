// src/lib/game/__tests__/mapGenQueue.test.ts
// #291 — mirrors imageGenQueue.test.ts's coverage shape exactly (enqueue
// dedupe, atomic claim semantics, retry bookkeeping, pure stale-job
// recovery decisions, and both of #120's kickJob fixes carried over).

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    mapGenerationJob: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn(),
    },
  },
}))
vi.mock('../../ai/ai-visual-service', () => ({
  AIVisualService: { generateMapFromScene: vi.fn() },
}))
vi.mock('../../maps/map-service', () => ({
  MapService: { pruneOldMaps: vi.fn().mockResolvedValue(0) },
}))
vi.mock('@/lib/realtime/pusher-server', () => ({
  default: vi.fn(() => ({ trigger: vi.fn().mockResolvedValue(undefined) })),
}))
vi.mock('@/lib/monitoring', () => ({
  reportError: vi.fn().mockResolvedValue(undefined),
}))

import { prisma } from '@/lib/prisma'
import { AIVisualService } from '../../ai/ai-visual-service'
import { MapService } from '../../maps/map-service'
import {
  enqueueMapGeneration,
  processMapGenJob,
  classifyStaleMapJob,
  kickMapJob,
  MAX_ATTEMPTS,
  RUNNING_STALE_MS,
  PENDING_STALE_MS,
} from '../mapGenQueue'

const db = prisma as any

beforeEach(() => {
  vi.clearAllMocks()
  // kickMapJob's fetch: pretend delivery succeeds instantly.
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
})

describe('enqueueMapGeneration', () => {
  it('dedupes onto an existing PENDING/RUNNING job', async () => {
    db.mapGenerationJob.findUnique.mockResolvedValue({ id: 'map1', status: 'PENDING' })
    const result = await enqueueMapGeneration('camp1', 'scene1', 'a scene description')
    expect(result).toEqual({ jobId: 'map1', deduped: true })
    expect(db.mapGenerationJob.create).not.toHaveBeenCalled()
    expect(db.mapGenerationJob.update).not.toHaveBeenCalled()
  })

  it('dedupes onto an existing COMPLETED job rather than regenerating', async () => {
    db.mapGenerationJob.findUnique.mockResolvedValue({ id: 'map1', status: 'COMPLETED' })
    const result = await enqueueMapGeneration('camp1', 'scene1', 'a scene description')
    expect(result).toEqual({ jobId: 'map1', deduped: true })
    expect(db.mapGenerationJob.create).not.toHaveBeenCalled()
    expect(db.mapGenerationJob.update).not.toHaveBeenCalled()
  })

  it('creates and kicks a new job when none exists yet', async () => {
    db.mapGenerationJob.findUnique.mockResolvedValue(null)
    db.mapGenerationJob.create.mockResolvedValue({ id: 'map2' })
    const result = await enqueueMapGeneration('camp1', 'scene1', 'a scene description', 'prevMap1')
    expect(result).toEqual({ jobId: 'map2', deduped: false })
    expect(db.mapGenerationJob.create).toHaveBeenCalledWith({
      data: { campaignId: 'camp1', sceneId: 'scene1', sceneDescription: 'a scene description', previousMapId: 'prevMap1' },
    })
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/internal/generate-map'),
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('resets a FAILED job and retries instead of colliding with the unique constraint', async () => {
    db.mapGenerationJob.findUnique.mockResolvedValue({ id: 'map3', status: 'FAILED' })
    db.mapGenerationJob.update.mockResolvedValue({ id: 'map3' })
    const result = await enqueueMapGeneration('camp1', 'scene1', 'a new description')
    expect(result).toEqual({ jobId: 'map3', deduped: false })
    expect(db.mapGenerationJob.create).not.toHaveBeenCalled()
    expect(db.mapGenerationJob.update).toHaveBeenCalledWith({
      where: { id: 'map3' },
      data: { status: 'PENDING', sceneDescription: 'a new description', previousMapId: undefined, attempts: 0, lastError: null, finishedAt: null },
    })
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/internal/generate-map'),
      expect.objectContaining({ method: 'POST' })
    )
  })
})

describe('kickMapJob (#120 fixes carried over)', () => {
  it('falls back to inline processing when the worker route responds fast but non-OK', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }))
    db.mapGenerationJob.updateMany.mockResolvedValue({ count: 1 })
    db.mapGenerationJob.findUnique.mockResolvedValue({ id: 'map1', campaignId: 'camp1', sceneId: 'scene1', sceneDescription: 'x', previousMapId: null, attempts: 1 })

    await kickMapJob('map1')

    expect(db.mapGenerationJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'map1', status: 'PENDING' } })
    )
  })

  it('does not fall back to inline processing on an OK response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }))
    await kickMapJob('map1')
    expect(db.mapGenerationJob.updateMany).not.toHaveBeenCalled()
  })
})

describe('processMapGenJob', () => {
  it('skips when the claim is lost (already RUNNING elsewhere)', async () => {
    db.mapGenerationJob.updateMany.mockResolvedValue({ count: 0 })
    const result = await processMapGenJob('map1')
    expect(result.status).toBe('skipped')
    expect(AIVisualService.generateMapFromScene).not.toHaveBeenCalled()
  })

  it('fails without retrying when the claimed row has no scene description', async () => {
    db.mapGenerationJob.updateMany.mockResolvedValue({ count: 1 })
    db.mapGenerationJob.findUnique.mockResolvedValue({ id: 'map1', campaignId: 'camp1', sceneId: 'scene1', sceneDescription: null, previousMapId: null, attempts: 1 })

    const result = await processMapGenJob('map1')

    expect(result.status).toBe('failed')
    expect(AIVisualService.generateMapFromScene).not.toHaveBeenCalled()
    expect(db.mapGenerationJob.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) })
    )
  })

  it('generates, prunes, completes, and broadcasts on success', async () => {
    db.mapGenerationJob.updateMany.mockResolvedValue({ count: 1 })
    db.mapGenerationJob.findUnique.mockResolvedValue({ id: 'map1', campaignId: 'camp1', sceneId: 'scene1', sceneDescription: 'a scene', previousMapId: 'prevMap1', attempts: 1 })
    ;(AIVisualService.generateMapFromScene as any).mockResolvedValue({ mapId: 'newMap1' })

    const result = await processMapGenJob('map1')

    expect(AIVisualService.generateMapFromScene).toHaveBeenCalledWith('a scene', 'camp1', 'prevMap1')
    expect(MapService.pruneOldMaps).toHaveBeenCalledWith('camp1')
    expect(db.mapGenerationJob.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED' }) })
    )
    expect(result.status).toBe('completed')
  })

  it('still completes successfully even if the Pusher broadcast fails', async () => {
    const PusherServer = (await import('@/lib/realtime/pusher-server')).default
    ;(PusherServer as any).mockReturnValueOnce({ trigger: vi.fn().mockRejectedValue(new Error('pusher down')) })
    db.mapGenerationJob.updateMany.mockResolvedValue({ count: 1 })
    db.mapGenerationJob.findUnique.mockResolvedValue({ id: 'map1', campaignId: 'camp1', sceneId: 'scene1', sceneDescription: 'a scene', previousMapId: null, attempts: 1 })
    ;(AIVisualService.generateMapFromScene as any).mockResolvedValue({ mapId: 'newMap1' })

    const result = await processMapGenJob('map1')

    expect(result.status).toBe('completed')
  })

  it('returns the job to PENDING on failure while attempts remain', async () => {
    db.mapGenerationJob.updateMany.mockResolvedValue({ count: 1 })
    db.mapGenerationJob.findUnique.mockResolvedValue({ id: 'map1', campaignId: 'camp1', sceneId: 'scene1', sceneDescription: 'a scene', previousMapId: null, attempts: 1 })
    ;(AIVisualService.generateMapFromScene as any).mockRejectedValue(new Error('rate limited'))

    const result = await processMapGenJob('map1')

    expect(result.status).toBe('retry_scheduled')
    expect(db.mapGenerationJob.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PENDING', lastError: 'rate limited' }) })
    )
  })

  it('fails terminally once attempts are exhausted', async () => {
    db.mapGenerationJob.updateMany.mockResolvedValue({ count: 1 })
    db.mapGenerationJob.findUnique.mockResolvedValue({ id: 'map1', campaignId: 'camp1', sceneId: 'scene1', sceneDescription: 'a scene', previousMapId: null, attempts: MAX_ATTEMPTS })
    ;(AIVisualService.generateMapFromScene as any).mockRejectedValue(new Error('still broken'))

    const result = await processMapGenJob('map1')

    expect(result.status).toBe('failed')
    expect(db.mapGenerationJob.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) })
    )
  })

  it('reverts a stranded claim to PENDING when reading the job back fails', async () => {
    db.mapGenerationJob.updateMany.mockResolvedValue({ count: 1 })
    db.mapGenerationJob.findUnique.mockRejectedValue(new Error('connection reset'))

    const result = await processMapGenJob('map1')

    expect(result.status).toBe('retry_scheduled')
    expect(AIVisualService.generateMapFromScene).not.toHaveBeenCalled()
    expect(db.mapGenerationJob.update).toHaveBeenCalledWith({ where: { id: 'map1' }, data: { status: 'PENDING' } })
  })
})

describe('classifyStaleMapJob (pure recovery decisions)', () => {
  const now = 1_000_000_000
  const job = (overrides: any) => ({
    id: 'j', status: 'PENDING', attempts: 1,
    updatedAt: new Date(now), startedAt: null, ...overrides,
  })

  it('waits on fresh jobs', () => {
    expect(classifyStaleMapJob(job({}), now)).toBe('wait')
    expect(
      classifyStaleMapJob(job({ status: 'RUNNING', startedAt: new Date(now - 1000) }), now)
    ).toBe('wait')
  })

  it('re-kicks a PENDING job whose kick was lost', () => {
    expect(
      classifyStaleMapJob(job({ updatedAt: new Date(now - PENDING_STALE_MS - 1) }), now)
    ).toBe('kick')
  })

  it('resets a crashed RUNNING job while attempts remain', () => {
    expect(
      classifyStaleMapJob(
        job({ status: 'RUNNING', startedAt: new Date(now - RUNNING_STALE_MS - 1), attempts: 1 }),
        now
      )
    ).toBe('reset_and_kick')
  })

  it('abandons a stale RUNNING job out of attempts', () => {
    expect(
      classifyStaleMapJob(
        job({ status: 'RUNNING', startedAt: new Date(now - RUNNING_STALE_MS - 1), attempts: MAX_ATTEMPTS }),
        now
      )
    ).toBe('fail')
  })
})
