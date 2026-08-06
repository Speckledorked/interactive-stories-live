// src/app/api/campaigns/[id]/scenes/[sceneId]/regenerate-intro/__tests__/route.test.ts
// #135 (cont.) — regenerating a scene's intro had no test coverage: the
// membership gate (any member can trigger it — there's no human GM in
// this product), the world-seeding gate, cross-campaign scene scoping,
// and the "only an untouched scene" guard (actions taken OR already
// resolved both block it, since swapping the intro out from under either
// would orphan history), were all unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({ getCampaignMembership: vi.fn() }))
vi.mock('@/lib/rateLimit', () => ({
  AI_ACTION_LIMIT: { bucket: 'ai-action', limit: 20, windowSeconds: 60 },
  checkRateLimit: vi.fn(),
  rateLimitExceededResponse: vi.fn(),
}))
vi.mock('@/lib/lore/seedingGate', () => ({
  isWorldSeeding: vi.fn(),
  SEEDING_MESSAGE: 'World is still seeding',
}))
vi.mock('@/lib/ai/worldState', () => ({ generateNewSceneIntro: vi.fn() }))
vi.mock('@/lib/realtime/pusher-server', () => ({
  default: vi.fn(() => ({ trigger: vi.fn() })),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: { scene: { findUnique: vi.fn(), update: vi.fn() } },
}))

import { requireAuth } from '@/lib/auth'
import { getCampaignMembership } from '@/lib/db/campaignAccess'
import { checkRateLimit, rateLimitExceededResponse } from '@/lib/rateLimit'
import { isWorldSeeding } from '@/lib/lore/seedingGate'
import { generateNewSceneIntro } from '@/lib/ai/worldState'
import { prisma } from '@/lib/prisma'
import { POST } from '../route'

const db = prisma as any

function req() {
  return new NextRequest('http://localhost/api/campaigns/camp1/scenes/scene1/regenerate-intro', { method: 'POST' })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(requireAuth as any).mockResolvedValue({ userId: 'player1' })
  ;(checkRateLimit as any).mockResolvedValue({ allowed: true })
  ;(getCampaignMembership as any).mockResolvedValue({ role: 'PLAYER' })
  ;(isWorldSeeding as any).mockResolvedValue(false)
  db.scene.findUnique.mockResolvedValue({
    id: 'scene1', campaignId: 'camp1', sceneNumber: 2, status: 'AWAITING_ACTIONS',
    playerActions: [], sceneResolutionText: null, participants: null,
  })
  ;(generateNewSceneIntro as any).mockResolvedValue('New intro text')
  db.scene.update.mockResolvedValue({ id: 'scene1', sceneNumber: 2, sceneIntroText: 'New intro text' })
})

describe('POST', () => {
  it('is rate limited', async () => {
    ;(checkRateLimit as any).mockResolvedValue({ allowed: false })
    ;(rateLimitExceededResponse as any).mockReturnValue(new Response(null, { status: 429 }))
    const response = await POST(req(), { params: { id: 'camp1', sceneId: 'scene1' } })
    expect(response.status).toBe(429)
  })

  it('rejects a non-member', async () => {
    ;(getCampaignMembership as any).mockResolvedValue(null)
    const response = await POST(req(), { params: { id: 'camp1', sceneId: 'scene1' } })
    expect(response.status).toBe(403)
  })

  it('blocks during world seeding', async () => {
    ;(isWorldSeeding as any).mockResolvedValue(true)
    const response = await POST(req(), { params: { id: 'camp1', sceneId: 'scene1' } })
    expect(response.status).toBe(409)
    expect(generateNewSceneIntro).not.toHaveBeenCalled()
  })

  it('404s for a scene from a different campaign', async () => {
    db.scene.findUnique.mockResolvedValue({ id: 'scene1', campaignId: 'other-camp', status: 'AWAITING_ACTIONS', playerActions: [] })
    const response = await POST(req(), { params: { id: 'camp1', sceneId: 'scene1' } })
    expect(response.status).toBe(404)
  })

  it('refuses to regenerate a scene that already has actions', async () => {
    db.scene.findUnique.mockResolvedValue({
      id: 'scene1', campaignId: 'camp1', status: 'AWAITING_ACTIONS',
      playerActions: [{ id: 'a1' }], sceneResolutionText: null,
    })
    const response = await POST(req(), { params: { id: 'camp1', sceneId: 'scene1' } })
    expect(response.status).toBe(400)
    expect(generateNewSceneIntro).not.toHaveBeenCalled()
  })

  it('refuses to regenerate an already-resolved scene', async () => {
    db.scene.findUnique.mockResolvedValue({
      id: 'scene1', campaignId: 'camp1', status: 'AWAITING_ACTIONS',
      playerActions: [], sceneResolutionText: 'already resolved',
    })
    const response = await POST(req(), { params: { id: 'camp1', sceneId: 'scene1' } })
    expect(response.status).toBe(400)
  })

  it('rejects a scene not in AWAITING_ACTIONS status', async () => {
    db.scene.findUnique.mockResolvedValue({
      id: 'scene1', campaignId: 'camp1', status: 'RESOLVING',
      playerActions: [], sceneResolutionText: null,
    })
    const response = await POST(req(), { params: { id: 'camp1', sceneId: 'scene1' } })
    expect(response.status).toBe(400)
  })

  it('regenerates the intro for a valid untouched scene', async () => {
    const response = await POST(req(), { params: { id: 'camp1', sceneId: 'scene1' } })
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body).toEqual({ success: true, scene: { id: 'scene1', sceneNumber: 2, introText: 'New intro text' } })
  })
})
