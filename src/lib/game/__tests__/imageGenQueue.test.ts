// src/lib/game/__tests__/imageGenQueue.test.ts
// #96 — mirrors resolutionQueue.test.ts's coverage shape exactly (enqueue
// dedupe, atomic claim semantics, retry bookkeeping, pure stale-job
// recovery decisions, and both of #120's kickJob fixes carried over from
// day one rather than rediscovered as a future bug on this file).

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    sceneImage: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn(),
    },
  },
}))
vi.mock('../../ai/imageGeneration', () => ({
  generateSceneImage: vi.fn(),
}))
vi.mock('../../blob/sceneImageStorage', () => ({
  uploadSceneImage: vi.fn(),
}))
vi.mock('@/lib/realtime/pusher-server', () => ({
  default: vi.fn(() => ({ trigger: vi.fn().mockResolvedValue(undefined) })),
}))
vi.mock('@/lib/monitoring', () => ({
  reportError: vi.fn().mockResolvedValue(undefined),
}))

import { prisma } from '@/lib/prisma'
import { generateSceneImage } from '../../ai/imageGeneration'
import { uploadSceneImage } from '../../blob/sceneImageStorage'
import {
  enqueueSceneImageGeneration,
  processImageGenJob,
  classifyStaleImageJob,
  kickImageJob,
  MAX_ATTEMPTS,
  RUNNING_STALE_MS,
  PENDING_STALE_MS,
} from '../imageGenQueue'

const db = prisma as any

beforeEach(() => {
  vi.clearAllMocks()
  // kickImageJob's fetch: pretend delivery succeeds instantly.
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
})

describe('enqueueSceneImageGeneration', () => {
  it('dedupes onto an existing PENDING/RUNNING job', async () => {
    db.sceneImage.findUnique.mockResolvedValue({ id: 'img1', status: 'PENDING' })
    const result = await enqueueSceneImageGeneration('camp1', 'scene1', 'a prompt')
    expect(result).toEqual({ jobId: 'img1', deduped: true })
    expect(db.sceneImage.create).not.toHaveBeenCalled()
    expect(db.sceneImage.update).not.toHaveBeenCalled()
  })

  it('dedupes onto an existing COMPLETED job rather than regenerating', async () => {
    db.sceneImage.findUnique.mockResolvedValue({ id: 'img1', status: 'COMPLETED' })
    const result = await enqueueSceneImageGeneration('camp1', 'scene1', 'a prompt')
    expect(result).toEqual({ jobId: 'img1', deduped: true })
    expect(db.sceneImage.create).not.toHaveBeenCalled()
    expect(db.sceneImage.update).not.toHaveBeenCalled()
  })

  it('creates and kicks a new job when none exists yet', async () => {
    db.sceneImage.findUnique.mockResolvedValue(null)
    db.sceneImage.create.mockResolvedValue({ id: 'img2' })
    const result = await enqueueSceneImageGeneration('camp1', 'scene1', 'a prompt')
    expect(result).toEqual({ jobId: 'img2', deduped: false })
    expect(db.sceneImage.create).toHaveBeenCalledWith({ data: { campaignId: 'camp1', sceneId: 'scene1', prompt: 'a prompt' } })
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/internal/generate-scene-image'),
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('resets a FAILED job and retries instead of colliding with the unique constraint', async () => {
    db.sceneImage.findUnique.mockResolvedValue({ id: 'img3', status: 'FAILED' })
    db.sceneImage.update.mockResolvedValue({ id: 'img3' })
    const result = await enqueueSceneImageGeneration('camp1', 'scene1', 'a new prompt')
    expect(result).toEqual({ jobId: 'img3', deduped: false })
    expect(db.sceneImage.create).not.toHaveBeenCalled()
    expect(db.sceneImage.update).toHaveBeenCalledWith({
      where: { id: 'img3' },
      data: { status: 'PENDING', prompt: 'a new prompt', attempts: 0, lastError: null, finishedAt: null, imageUrl: null },
    })
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/internal/generate-scene-image'),
      expect.objectContaining({ method: 'POST' })
    )
  })
})

describe('kickImageJob (#120 fixes carried over)', () => {
  it('falls back to inline processing when the worker route responds fast but non-OK', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }))
    db.sceneImage.updateMany.mockResolvedValue({ count: 1 })
    db.sceneImage.findUnique.mockResolvedValue({ id: 'img1', campaignId: 'camp1', sceneId: 'scene1', prompt: 'a prompt', attempts: 1 })

    await kickImageJob('img1')

    expect(db.sceneImage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'img1', status: 'PENDING' } })
    )
  })

  it('does not fall back to inline processing on an OK response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }))
    await kickImageJob('img1')
    expect(db.sceneImage.updateMany).not.toHaveBeenCalled()
  })
})

describe('processImageGenJob', () => {
  it('skips when the claim is lost (already RUNNING elsewhere)', async () => {
    db.sceneImage.updateMany.mockResolvedValue({ count: 0 })
    const result = await processImageGenJob('img1')
    expect(result.status).toBe('skipped')
    expect(generateSceneImage).not.toHaveBeenCalled()
  })

  it('fails without retrying when the claimed row has no prompt', async () => {
    db.sceneImage.updateMany.mockResolvedValue({ count: 1 })
    db.sceneImage.findUnique.mockResolvedValue({ id: 'img1', campaignId: 'camp1', sceneId: 'scene1', prompt: null, attempts: 1 })

    const result = await processImageGenJob('img1')

    expect(result.status).toBe('failed')
    expect(generateSceneImage).not.toHaveBeenCalled()
    expect(db.sceneImage.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) })
    )
  })

  it('generates, uploads, completes, and broadcasts on success', async () => {
    db.sceneImage.updateMany.mockResolvedValue({ count: 1 })
    db.sceneImage.findUnique.mockResolvedValue({ id: 'img1', campaignId: 'camp1', sceneId: 'scene1', prompt: 'a prompt', attempts: 1 })
    ;(generateSceneImage as any).mockResolvedValue({ imageBuffer: Buffer.from('x'), contentType: 'image/png' })
    ;(uploadSceneImage as any).mockResolvedValue('https://blob.example/scene1.png')

    const result = await processImageGenJob('img1')

    expect(generateSceneImage).toHaveBeenCalledWith('camp1', 'scene1', 'a prompt')
    expect(uploadSceneImage).toHaveBeenCalledWith('scene1', expect.any(Buffer), 'image/png')
    expect(db.sceneImage.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED', imageUrl: 'https://blob.example/scene1.png' }) })
    )
    expect(result.status).toBe('completed')
  })

  it('still completes successfully even if the Pusher broadcast fails', async () => {
    const PusherServer = (await import('@/lib/realtime/pusher-server')).default
    ;(PusherServer as any).mockReturnValueOnce({ trigger: vi.fn().mockRejectedValue(new Error('pusher down')) })
    db.sceneImage.updateMany.mockResolvedValue({ count: 1 })
    db.sceneImage.findUnique.mockResolvedValue({ id: 'img1', campaignId: 'camp1', sceneId: 'scene1', prompt: 'a prompt', attempts: 1 })
    ;(generateSceneImage as any).mockResolvedValue({ imageBuffer: Buffer.from('x'), contentType: 'image/png' })
    ;(uploadSceneImage as any).mockResolvedValue('https://blob.example/scene1.png')

    const result = await processImageGenJob('img1')

    expect(result.status).toBe('completed')
  })

  it('returns the job to PENDING on failure while attempts remain', async () => {
    db.sceneImage.updateMany.mockResolvedValue({ count: 1 })
    db.sceneImage.findUnique.mockResolvedValue({ id: 'img1', campaignId: 'camp1', sceneId: 'scene1', prompt: 'a prompt', attempts: 1 })
    ;(generateSceneImage as any).mockRejectedValue(new Error('rate limited'))

    const result = await processImageGenJob('img1')

    expect(result.status).toBe('retry_scheduled')
    expect(db.sceneImage.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PENDING', lastError: 'rate limited' }) })
    )
  })

  it('fails terminally once attempts are exhausted', async () => {
    db.sceneImage.updateMany.mockResolvedValue({ count: 1 })
    db.sceneImage.findUnique.mockResolvedValue({ id: 'img1', campaignId: 'camp1', sceneId: 'scene1', prompt: 'a prompt', attempts: MAX_ATTEMPTS })
    ;(generateSceneImage as any).mockRejectedValue(new Error('still broken'))

    const result = await processImageGenJob('img1')

    expect(result.status).toBe('failed')
    expect(db.sceneImage.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) })
    )
  })

  it('reverts a stranded claim to PENDING when reading the job back fails', async () => {
    db.sceneImage.updateMany.mockResolvedValue({ count: 1 })
    db.sceneImage.findUnique.mockRejectedValue(new Error('connection reset'))

    const result = await processImageGenJob('img1')

    expect(result.status).toBe('retry_scheduled')
    expect(generateSceneImage).not.toHaveBeenCalled()
    expect(db.sceneImage.update).toHaveBeenCalledWith({ where: { id: 'img1' }, data: { status: 'PENDING' } })
  })
})

describe('classifyStaleImageJob (pure recovery decisions)', () => {
  const now = 1_000_000_000
  const job = (overrides: any) => ({
    id: 'j', status: 'PENDING', attempts: 1,
    updatedAt: new Date(now), startedAt: null, ...overrides,
  })

  it('waits on fresh jobs', () => {
    expect(classifyStaleImageJob(job({}), now)).toBe('wait')
    expect(
      classifyStaleImageJob(job({ status: 'RUNNING', startedAt: new Date(now - 1000) }), now)
    ).toBe('wait')
  })

  it('re-kicks a PENDING job whose kick was lost', () => {
    expect(
      classifyStaleImageJob(job({ updatedAt: new Date(now - PENDING_STALE_MS - 1) }), now)
    ).toBe('kick')
  })

  it('resets a crashed RUNNING job while attempts remain', () => {
    expect(
      classifyStaleImageJob(
        job({ status: 'RUNNING', startedAt: new Date(now - RUNNING_STALE_MS - 1), attempts: 1 }),
        now
      )
    ).toBe('reset_and_kick')
  })

  it('abandons a stale RUNNING job out of attempts', () => {
    expect(
      classifyStaleImageJob(
        job({ status: 'RUNNING', startedAt: new Date(now - RUNNING_STALE_MS - 1), attempts: MAX_ATTEMPTS }),
        now
      )
    ).toBe('fail')
  })
})
