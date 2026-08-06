// src/app/api/campaigns/[id]/scene/ask-gm/__tests__/route.test.ts
// #135 (cont.) — "Ask the GM" had no test coverage: the moderation gate,
// the character-ownership check, the AWAITING_ACTIONS-only guard (asking
// mid-resolution risks grounding the answer in state that's about to
// change), and the best-effort (non-blocking) Pusher broadcast were all
// unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: { findUnique: vi.fn() },
    character: { findUnique: vi.fn() },
    scene: { findUnique: vi.fn() },
    gmClarification: { create: vi.fn() },
  },
}))
vi.mock('@/lib/realtime/pusher-server', () => ({ PusherServer: vi.fn() }))
vi.mock('@/lib/rateLimit', () => ({
  AI_ACTION_LIMIT: { bucket: 'ai-action', limit: 20, windowSeconds: 60 },
  checkRateLimit: vi.fn(),
  rateLimitExceededResponse: vi.fn(),
}))
vi.mock('@/lib/ai/moderation', () => ({ moderatePlayerText: vi.fn() }))
vi.mock('@/lib/ai/askGm', () => ({ generateGmAnswer: vi.fn(), MAX_QUESTION_CHARS: 500 }))

import { requireAuth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { PusherServer } from '@/lib/realtime/pusher-server'
import { checkRateLimit, rateLimitExceededResponse } from '@/lib/rateLimit'
import { moderatePlayerText } from '@/lib/ai/moderation'
import { generateGmAnswer } from '@/lib/ai/askGm'
import { POST } from '../route'

const db = prisma as any

function req(body: unknown) {
  return new NextRequest('http://localhost/api/campaigns/camp1/scene/ask-gm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const validBody = { sceneId: 'scene1', characterId: 'char1', question: 'What does the room smell like?' }

beforeEach(() => {
  vi.clearAllMocks()
  ;(requireAuth as any).mockResolvedValue({ userId: 'player1' })
  ;(checkRateLimit as any).mockResolvedValue({ allowed: true })
  ;(moderatePlayerText as any).mockResolvedValue({ flagged: false, categories: [] })
  ;(PusherServer as any).mockReturnValue(null)
  db.campaign.findUnique.mockResolvedValue({ title: 'Test Campaign', universe: 'Fantasy', contentModerationLevel: 'standard' })
  db.character.findUnique.mockResolvedValue({ id: 'char1', userId: 'player1', name: 'Rowan' })
  db.scene.findUnique.mockResolvedValue({ id: 'scene1', campaignId: 'camp1', status: 'AWAITING_ACTIONS', sceneIntroText: 'intro', sceneResolutionText: null })
  ;(generateGmAnswer as any).mockResolvedValue('It smells of old parchment.')
  db.gmClarification.create.mockResolvedValue({
    id: 'clar1', characterId: 'char1', question: validBody.question, answer: 'It smells of old parchment.', createdAt: new Date(),
    character: { id: 'char1', name: 'Rowan' },
  })
})

describe('POST', () => {
  it('rejects an unauthenticated request', async () => {
    ;(requireAuth as any).mockRejectedValue(new Error('Unauthorized'))
    const response = await POST(req(validBody), { params: { id: 'camp1' } })
    expect(response.status).toBe(401)
  })

  it('rejects a request missing a required field', async () => {
    const response = await POST(req({ sceneId: 'scene1', characterId: 'char1' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(400)
  })

  it('is rate limited', async () => {
    ;(checkRateLimit as any).mockResolvedValue({ allowed: false, retryAfterSeconds: 5 })
    ;(rateLimitExceededResponse as any).mockReturnValue(new Response(null, { status: 429 }))
    const response = await POST(req(validBody), { params: { id: 'camp1' } })
    expect(response.status).toBe(429)
  })

  it('404s when the campaign does not exist', async () => {
    db.campaign.findUnique.mockResolvedValue(null)
    const response = await POST(req(validBody), { params: { id: 'camp1' } })
    expect(response.status).toBe(404)
  })

  it('blocks a flagged question', async () => {
    ;(moderatePlayerText as any).mockResolvedValue({ flagged: true, categories: ['violence'] })
    const response = await POST(req(validBody), { params: { id: 'camp1' } })
    expect(response.status).toBe(400)
    expect(generateGmAnswer).not.toHaveBeenCalled()
  })

  it('rejects asking as a character you do not own', async () => {
    db.character.findUnique.mockResolvedValue({ id: 'char1', userId: 'someone-else' })
    const response = await POST(req(validBody), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
  })

  it('404s when the scene does not exist or belongs to a different campaign', async () => {
    db.scene.findUnique.mockResolvedValue({ id: 'scene1', campaignId: 'other-camp', status: 'AWAITING_ACTIONS' })
    const response = await POST(req(validBody), { params: { id: 'camp1' } })
    expect(response.status).toBe(404)
  })

  it('rejects asking mid-resolution', async () => {
    db.scene.findUnique.mockResolvedValue({ id: 'scene1', campaignId: 'camp1', status: 'RESOLVING' })
    const response = await POST(req(validBody), { params: { id: 'camp1' } })
    expect(response.status).toBe(400)
    expect(generateGmAnswer).not.toHaveBeenCalled()
  })

  it('returns 502 when the GM cannot produce an answer', async () => {
    ;(generateGmAnswer as any).mockResolvedValue(null)
    const response = await POST(req(validBody), { params: { id: 'camp1' } })
    expect(response.status).toBe(502)
    expect(db.gmClarification.create).not.toHaveBeenCalled()
  })

  it('creates the clarification and returns it', async () => {
    const response = await POST(req(validBody), { params: { id: 'camp1' } })
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.clarification.answer).toBe('It smells of old parchment.')
  })

  it('broadcasts the clarification over Pusher when configured', async () => {
    const trigger = vi.fn().mockResolvedValue(undefined)
    ;(PusherServer as any).mockReturnValue({ trigger })

    await POST(req(validBody), { params: { id: 'camp1' } })

    expect(trigger).toHaveBeenCalledWith('campaign-camp1', 'gm:clarification', expect.objectContaining({ id: 'clar1' }))
  })

  it('still succeeds when the Pusher broadcast fails (non-critical)', async () => {
    ;(PusherServer as any).mockReturnValue({ trigger: vi.fn().mockRejectedValue(new Error('pusher down')) })
    const response = await POST(req(validBody), { params: { id: 'camp1' } })
    expect(response.status).toBe(200)
  })

  it('returns 500 on an unexpected error', async () => {
    db.campaign.findUnique.mockRejectedValue(new Error('db down'))
    const response = await POST(req(validBody), { params: { id: 'camp1' } })
    expect(response.status).toBe(500)
  })
})
