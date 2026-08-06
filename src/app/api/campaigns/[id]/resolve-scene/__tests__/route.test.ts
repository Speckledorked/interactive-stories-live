// src/app/api/campaigns/[id]/resolve-scene/__tests__/route.test.ts
// #135 (cont.) — the force-resolve-scene route had no test coverage: the
// admin-only gate (normal resolution happens automatically — this is the
// host override), the rate limit, the "no actions submitted yet" guard,
// and that it enqueues rather than resolving inline, were all
// unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn() }))
vi.mock('@/lib/rateLimit', () => ({
  AI_ACTION_LIMIT: { bucket: 'ai-action', limit: 20, windowSeconds: 60 },
  checkRateLimit: vi.fn(),
  rateLimitExceededResponse: vi.fn(),
}))
vi.mock('@/lib/game/sceneResolver', () => ({ getCurrentScene: vi.fn() }))
vi.mock('@/lib/game/resolutionQueue', () => ({ enqueueSceneResolution: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { campaign: { findUnique: vi.fn() }, scene: { findFirst: vi.fn() } },
}))

import { requireAuth } from '@/lib/auth'
import { checkRateLimit, rateLimitExceededResponse } from '@/lib/rateLimit'
import { getCurrentScene } from '@/lib/game/sceneResolver'
import { enqueueSceneResolution } from '@/lib/game/resolutionQueue'
import { prisma } from '@/lib/prisma'
import { POST } from '../route'

const db = prisma as any

function req(body: unknown = {}) {
  return new NextRequest('http://localhost/api/campaigns/camp1/resolve-scene', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(requireAuth as any).mockResolvedValue({ userId: 'admin1' })
  ;(checkRateLimit as any).mockResolvedValue({ allowed: true })
  db.campaign.findUnique.mockResolvedValue({
    id: 'camp1',
    memberships: [{ userId: 'admin1', role: 'ADMIN' }],
  })
  ;(getCurrentScene as any).mockResolvedValue({ id: 's1', sceneNumber: 3, playerActions: [{ id: 'a1' }] })
  ;(enqueueSceneResolution as any).mockResolvedValue({ jobId: 'job1', deduped: false })
})

describe('POST', () => {
  it('rejects an unauthenticated request', async () => {
    ;(requireAuth as any).mockRejectedValue(new Error('Unauthorized'))
    const response = await POST(req(), { params: { id: 'camp1' } })
    expect(response.status).toBe(401)
  })

  it('is rate limited before any DB work', async () => {
    ;(checkRateLimit as any).mockResolvedValue({ allowed: false })
    ;(rateLimitExceededResponse as any).mockReturnValue(new Response(null, { status: 429 }))
    const response = await POST(req(), { params: { id: 'camp1' } })
    expect(response.status).toBe(429)
    expect(db.campaign.findUnique).not.toHaveBeenCalled()
  })

  it('returns 404 for a missing campaign', async () => {
    db.campaign.findUnique.mockResolvedValue(null)
    const response = await POST(req(), { params: { id: 'camp1' } })
    expect(response.status).toBe(404)
  })

  it('rejects a non-admin, even a member', async () => {
    db.campaign.findUnique.mockResolvedValue({
      id: 'camp1',
      memberships: [{ userId: 'admin1', role: 'PLAYER' }],
    })
    const response = await POST(req(), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
    expect(enqueueSceneResolution).not.toHaveBeenCalled()
  })

  it('returns 400 when there is no active scene to resolve', async () => {
    ;(getCurrentScene as any).mockResolvedValue(null)
    const response = await POST(req(), { params: { id: 'camp1' } })
    expect(response.status).toBe(400)
  })

  it('returns 400 when no actions have been submitted yet', async () => {
    ;(getCurrentScene as any).mockResolvedValue({ id: 's1', sceneNumber: 1, playerActions: [] })
    const response = await POST(req(), { params: { id: 'camp1' } })
    expect(response.status).toBe(400)
    expect(enqueueSceneResolution).not.toHaveBeenCalled()
  })

  it('404s for a requested sceneId not found in this campaign', async () => {
    db.scene.findFirst.mockResolvedValue(null)
    const response = await POST(req({ sceneId: 'other-scene' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(404)
  })

  it('enqueues resolution rather than resolving inline, returning 202', async () => {
    const response = await POST(req(), { params: { id: 'camp1' } })
    const body = await response.json()
    expect(response.status).toBe(202)
    expect(body).toEqual(expect.objectContaining({ success: true, jobId: 'job1', sceneNumber: 3 }))
    expect(enqueueSceneResolution).toHaveBeenCalledWith('camp1', 's1')
  })
})
