// src/app/api/campaigns/[id]/start-scene/__tests__/route.test.ts
// #135 (cont.) — starting a new scene had no test coverage: the
// world-seeding play lock, the character-ownership/already-in-a-scene
// validation, and the per-participant SCENE_STARTED credit (with its
// requester fallback when no fixed participant list exists yet) were all
// unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({ getCampaignMembership: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { character: { findMany: vi.fn() }, scene: { findMany: vi.fn() } },
}))
vi.mock('@/lib/rateLimit', () => ({
  AI_ACTION_LIMIT: { bucket: 'ai-action', limit: 20, windowSeconds: 60 },
  checkRateLimit: vi.fn(),
  rateLimitExceededResponse: vi.fn(),
}))
vi.mock('@/lib/lore/seedingGate', () => ({ isWorldSeeding: vi.fn(), SEEDING_MESSAGE: 'seeding' }))
vi.mock('@/lib/game/sceneResolver', () => ({ createNewScene: vi.fn() }))
vi.mock('@/lib/analytics/events', () => ({ recordEvent: vi.fn() }))

import { requireAuth } from '@/lib/auth'
import { getCampaignMembership } from '@/lib/db/campaignAccess'
import { prisma } from '@/lib/prisma'
import { checkRateLimit, rateLimitExceededResponse } from '@/lib/rateLimit'
import { isWorldSeeding } from '@/lib/lore/seedingGate'
import { createNewScene } from '@/lib/game/sceneResolver'
import { recordEvent } from '@/lib/analytics/events'
import { POST } from '../route'

const db = prisma as any

function req(body: unknown) {
  return new NextRequest('http://localhost/api/campaigns/camp1/start-scene', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(requireAuth as any).mockResolvedValue({ userId: 'player1' })
  ;(checkRateLimit as any).mockResolvedValue({ allowed: true })
  ;(getCampaignMembership as any).mockResolvedValue({ role: 'PLAYER' })
  ;(isWorldSeeding as any).mockResolvedValue(false)
  db.scene.findMany.mockResolvedValue([])
})

describe('POST', () => {
  it('rejects an unauthenticated request', async () => {
    ;(requireAuth as any).mockRejectedValue(new Error('Unauthorized'))
    const response = await POST(req({}), { params: { id: 'camp1' } })
    expect(response.status).toBe(401)
  })

  it('is rate limited', async () => {
    ;(checkRateLimit as any).mockResolvedValue({ allowed: false, retryAfterSeconds: 5 })
    ;(rateLimitExceededResponse as any).mockReturnValue(new Response(null, { status: 429 }))
    const response = await POST(req({}), { params: { id: 'camp1' } })
    expect(response.status).toBe(429)
  })

  it('rejects a non-member', async () => {
    ;(getCampaignMembership as any).mockResolvedValue(null)
    const response = await POST(req({}), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
  })

  it('blocks scene creation while the world is still being seeded', async () => {
    ;(isWorldSeeding as any).mockResolvedValue(true)
    const response = await POST(req({}), { params: { id: 'camp1' } })
    expect(response.status).toBe(409)
    expect(createNewScene).not.toHaveBeenCalled()
  })

  it('rejects a characterId that does not belong to this campaign', async () => {
    db.character.findMany.mockResolvedValue([{ id: 'char1' }])
    const response = await POST(req({ characterIds: ['char1', 'char2'] }), { params: { id: 'camp1' } })
    expect(response.status).toBe(400)
    expect(createNewScene).not.toHaveBeenCalled()
  })

  it('rejects a character already in another active scene', async () => {
    db.character.findMany.mockResolvedValue([{ id: 'char1' }])
    db.scene.findMany.mockResolvedValue([
      { id: 'scene-existing', sceneNumber: 2, participants: { characterIds: ['char1'] } },
    ])
    const response = await POST(req({ characterIds: ['char1'] }), { params: { id: 'camp1' } })
    expect(response.status).toBe(400)
    expect(createNewScene).not.toHaveBeenCalled()
  })

  it('creates the scene and credits every real participant', async () => {
    db.character.findMany.mockResolvedValue([{ id: 'char1' }, { id: 'char2' }])
    ;(createNewScene as any).mockResolvedValue({
      id: 'scene1', sceneNumber: 1, sceneIntroText: 'It begins...', status: 'AWAITING_ACTIONS',
      participants: { characterIds: ['char1', 'char2'], userIds: ['userA', 'userB'] }, createdAt: new Date(),
    })

    const response = await POST(req({ characterIds: ['char1', 'char2'] }), { params: { id: 'camp1' } })
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.scene.introText).toBe('It begins...')
    expect(recordEvent).toHaveBeenCalledWith('SCENE_STARTED', { userId: 'userA', campaignId: 'camp1', metadata: { sceneNumber: 1 } })
    expect(recordEvent).toHaveBeenCalledWith('SCENE_STARTED', { userId: 'userB', campaignId: 'camp1', metadata: { sceneNumber: 1 } })
  })

  it('falls back to crediting the requester when the scene opens with no fixed participants', async () => {
    ;(createNewScene as any).mockResolvedValue({
      id: 'scene1', sceneNumber: 1, sceneIntroText: 'It begins...', status: 'AWAITING_ACTIONS',
      participants: {}, createdAt: new Date(),
    })

    await POST(req({}), { params: { id: 'camp1' } })

    expect(recordEvent).toHaveBeenCalledWith('SCENE_STARTED', { userId: 'player1', campaignId: 'camp1', metadata: { sceneNumber: 1 } })
  })

  it('returns 500 on an unexpected error', async () => {
    ;(createNewScene as any).mockRejectedValue(new Error('AI call failed'))
    const response = await POST(req({}), { params: { id: 'camp1' } })
    expect(response.status).toBe(500)
  })
})
