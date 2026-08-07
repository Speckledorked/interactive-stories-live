// src/app/api/campaigns/[id]/scenes/[sceneId]/generate-image/__tests__/route.test.ts
// Admin-only manual backfill for a scene that never got (or failed to
// get) an illustration — see route.ts's header comment.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({ requireCampaignAdmin: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: { findUnique: vi.fn() },
    scene: { findUnique: vi.fn() },
  },
}))
vi.mock('@/lib/game/imageGenQueue', () => ({ enqueueSceneImageGeneration: vi.fn() }))

import { requireAuth } from '@/lib/auth'
import { requireCampaignAdmin } from '@/lib/db/campaignAccess'
import { prisma } from '@/lib/prisma'
import { enqueueSceneImageGeneration } from '@/lib/game/imageGenQueue'
import { POST } from '../route'

const db = prisma as any

function req() {
  return new NextRequest('http://localhost/api/campaigns/camp1/scenes/scene1/generate-image', { method: 'POST' })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(requireAuth as any).mockResolvedValue({ userId: 'admin1', email: 'admin@example.com' })
  ;(requireCampaignAdmin as any).mockResolvedValue({ membership: { role: 'ADMIN' } })
  db.campaign.findUnique.mockResolvedValue({ sceneImageGenerationEnabled: true })
  db.scene.findUnique.mockResolvedValue({
    campaignId: 'camp1',
    sceneResolutionText: 'Kess ducks behind the crate as the shot goes wide.',
    sceneIntroText: 'The room is quiet.',
    framing: null,
    location: 'The docks',
  })
  ;(enqueueSceneImageGeneration as any).mockResolvedValue({ jobId: 'img1', deduped: false })
})

describe('POST /api/campaigns/[id]/scenes/[sceneId]/generate-image', () => {
  it('rejects a non-admin', async () => {
    ;(requireCampaignAdmin as any).mockResolvedValue({ response: new Response(null, { status: 403 }) })
    const response = await POST(req(), { params: { id: 'camp1', sceneId: 'scene1' } })
    expect(response.status).toBe(403)
    expect(enqueueSceneImageGeneration).not.toHaveBeenCalled()
  })

  it('refuses when scene image generation is disabled for the campaign', async () => {
    db.campaign.findUnique.mockResolvedValue({ sceneImageGenerationEnabled: false })
    const response = await POST(req(), { params: { id: 'camp1', sceneId: 'scene1' } })
    expect(response.status).toBe(400)
    expect(enqueueSceneImageGeneration).not.toHaveBeenCalled()
  })

  it('404s when the scene does not exist', async () => {
    db.scene.findUnique.mockResolvedValue(null)
    const response = await POST(req(), { params: { id: 'camp1', sceneId: 'scene1' } })
    expect(response.status).toBe(404)
  })

  it('refuses a scene belonging to a different campaign', async () => {
    db.scene.findUnique.mockResolvedValue({ campaignId: 'other-camp', sceneResolutionText: 'x' })
    const response = await POST(req(), { params: { id: 'camp1', sceneId: 'scene1' } })
    expect(response.status).toBe(400)
    expect(enqueueSceneImageGeneration).not.toHaveBeenCalled()
  })

  it('refuses a scene with no resolved exchange yet', async () => {
    db.scene.findUnique.mockResolvedValue({ campaignId: 'camp1', sceneResolutionText: null })
    const response = await POST(req(), { params: { id: 'camp1', sceneId: 'scene1' } })
    expect(response.status).toBe(400)
    expect(enqueueSceneImageGeneration).not.toHaveBeenCalled()
  })

  it('builds the prompt from only the FIRST exchange, even if the scene has moved on', async () => {
    db.scene.findUnique.mockResolvedValue({
      campaignId: 'camp1',
      sceneResolutionText: 'First exchange text.\n\n---\n\nSecond exchange text.\n\n---\n\nThird exchange text.',
      sceneIntroText: 'intro',
      framing: null,
      location: null,
    })

    await POST(req(), { params: { id: 'camp1', sceneId: 'scene1' } })

    const [, , prompt] = (enqueueSceneImageGeneration as any).mock.calls[0]
    expect(prompt).toContain('First exchange text.')
    expect(prompt).not.toContain('Second exchange text.')
    expect(prompt).not.toContain('Third exchange text.')
  })

  it('enqueues generation and returns 202 for a valid admin request', async () => {
    const response = await POST(req(), { params: { id: 'camp1', sceneId: 'scene1' } })
    const body = await response.json()

    expect(response.status).toBe(202)
    expect(body.status).toBe('PENDING')
    expect(body.deduped).toBe(false)
    expect(enqueueSceneImageGeneration).toHaveBeenCalledWith('camp1', 'scene1', expect.any(String))
  })

  it('reports deduped:true when the queue reuses an existing job', async () => {
    ;(enqueueSceneImageGeneration as any).mockResolvedValue({ jobId: 'img1', deduped: true })
    const response = await POST(req(), { params: { id: 'camp1', sceneId: 'scene1' } })
    const body = await response.json()
    expect(body.deduped).toBe(true)
  })
})
