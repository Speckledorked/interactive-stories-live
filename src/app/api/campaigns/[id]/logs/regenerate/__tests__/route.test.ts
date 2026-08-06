// src/app/api/campaigns/[id]/logs/regenerate/__tests__/route.test.ts
// #135 (cont.) — the Story Log resummarization pass had no test coverage:
// the rate limit, the admin-only gate, that consolidation always runs
// even when the capped resummarization pass has nothing to do, and that a
// per-entry AI failure is counted as `failed` rather than aborting the
// whole request, were all unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({ requireCampaignAdmin: vi.fn() }))
vi.mock('@/lib/rateLimit', () => ({
  AI_ACTION_LIMIT: { bucket: 'ai-action', limit: 20, windowSeconds: 60 },
  checkRateLimit: vi.fn(),
  rateLimitExceededResponse: vi.fn(),
}))
vi.mock('@/lib/ai/worldState', () => ({ summarizeSceneForLog: vi.fn() }))
vi.mock('@/lib/game/storyLogConsolidation', () => ({ planLogConsolidation: vi.fn(() => []) }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaignLog: { findMany: vi.fn(), deleteMany: vi.fn(), update: vi.fn(), count: vi.fn() },
    scene: { findMany: vi.fn() },
  },
}))

import { requireAuth } from '@/lib/auth'
import { requireCampaignAdmin } from '@/lib/db/campaignAccess'
import { checkRateLimit, rateLimitExceededResponse } from '@/lib/rateLimit'
import { summarizeSceneForLog } from '@/lib/ai/worldState'
import { planLogConsolidation } from '@/lib/game/storyLogConsolidation'
import { prisma } from '@/lib/prisma'
import { POST } from '../route'

const db = prisma as any

function req() {
  return new NextRequest('http://localhost/api/campaigns/camp1/logs/regenerate', { method: 'POST' })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(requireAuth as any).mockResolvedValue({ userId: 'admin1' })
  ;(checkRateLimit as any).mockResolvedValue({ allowed: true })
  ;(requireCampaignAdmin as any).mockResolvedValue({ membership: { role: 'ADMIN' } })
  ;(planLogConsolidation as any).mockReturnValue([])
  db.campaignLog.findMany.mockResolvedValue([])
  db.scene.findMany.mockResolvedValue([])
  db.campaignLog.count.mockResolvedValue(0)
})

describe('POST', () => {
  it('rejects an unauthenticated request', async () => {
    ;(requireAuth as any).mockRejectedValue(new Error('Unauthorized'))
    const response = await POST(req(), { params: { id: 'camp1' } })
    expect(response.status).toBe(401)
  })

  it('is rate limited', async () => {
    ;(checkRateLimit as any).mockResolvedValue({ allowed: false, retryAfterSeconds: 5 })
    ;(rateLimitExceededResponse as any).mockReturnValue(new Response(null, { status: 429 }))
    const response = await POST(req(), { params: { id: 'camp1' } })
    expect(response.status).toBe(429)
    expect(requireCampaignAdmin).not.toHaveBeenCalled()
  })

  it('rejects a non-admin', async () => {
    ;(requireCampaignAdmin as any).mockResolvedValue({ response: new Response(null, { status: 403 }) })
    const response = await POST(req(), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
  })

  it('returns zeroed counts when there is nothing to regenerate', async () => {
    const response = await POST(req(), { params: { id: 'camp1' } })
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body).toEqual({ regenerated: 0, failed: 0, remaining: 0, consolidated: 0 })
    expect(summarizeSceneForLog).not.toHaveBeenCalled()
  })

  it('consolidates duplicate rows even when nothing needs resummarizing', async () => {
    ;(planLogConsolidation as any).mockReturnValue([
      { canonicalId: 'l1', deleteIds: ['l2', 'l3'], mergedHighlights: ['a', 'b'] },
    ])
    const response = await POST(req(), { params: { id: 'camp1' } })
    const body = await response.json()
    expect(db.campaignLog.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['l2', 'l3'] } } })
    expect(db.campaignLog.update).toHaveBeenCalledWith({
      where: { id: 'l1' },
      data: { highlights: ['a', 'b'] },
    })
    expect(body.consolidated).toBe(2)
  })

  it('counts a missing scene text as failed rather than throwing', async () => {
    db.campaignLog.findMany.mockResolvedValue([{ id: 'l1', sceneId: 's1' }])
    db.scene.findMany.mockResolvedValue([{ id: 's1', sceneResolutionText: null }])
    const response = await POST(req(), { params: { id: 'camp1' } })
    const body = await response.json()
    expect(body.failed).toBe(1)
    expect(body.regenerated).toBe(0)
    expect(summarizeSceneForLog).not.toHaveBeenCalled()
  })

  it('counts a per-entry AI failure as failed without aborting the rest', async () => {
    db.campaignLog.findMany.mockResolvedValue([
      { id: 'l1', sceneId: 's1' },
      { id: 'l2', sceneId: 's2' },
    ])
    db.scene.findMany.mockResolvedValue([
      { id: 's1', sceneResolutionText: 'text one' },
      { id: 's2', sceneResolutionText: 'text two' },
    ])
    ;(summarizeSceneForLog as any)
      .mockRejectedValueOnce(new Error('AI down'))
      .mockResolvedValueOnce({ summary: 'ok', highlights: [] })

    const response = await POST(req(), { params: { id: 'camp1' } })
    const body = await response.json()
    expect(body.failed).toBe(1)
    expect(body.regenerated).toBe(1)
    expect(db.campaignLog.update).toHaveBeenCalledWith({
      where: { id: 'l2' },
      data: { summary: 'ok', highlights: [] },
    })
  })

  it('returns 500 on an unexpected error', async () => {
    db.campaignLog.findMany.mockRejectedValue(new Error('db down'))
    const response = await POST(req(), { params: { id: 'camp1' } })
    expect(response.status).toBe(500)
  })
})
