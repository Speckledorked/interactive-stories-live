// src/app/api/campaigns/[id]/end-scene/__tests__/route.test.ts
// #135 (cont.) — ending a scene had no test coverage: the "still mark
// RESOLVED even if final resolution fails" fallback, the billing
// preflight/charge sequence, and skipping resolution entirely when the
// scene has no pending actions were all unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({ getCampaignMembership: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { scene: { findUnique: vi.fn(), update: vi.fn() } },
}))
vi.mock('@/lib/realtime/pusher-server', () => ({ default: vi.fn() }))
vi.mock('@/lib/rateLimit', () => ({
  AI_ACTION_LIMIT: { bucket: 'ai-action', limit: 20, windowSeconds: 60 },
  checkRateLimit: vi.fn(),
  rateLimitExceededResponse: vi.fn(),
}))
vi.mock('@/lib/game/resolutionBilling', () => ({
  preflightSceneBilling: vi.fn(),
  chargeForSceneResolution: vi.fn(),
}))
vi.mock('@/lib/game/sceneResolver', () => ({ resolveScene: vi.fn() }))
vi.mock('@/lib/game/worldTurn', () => ({ runWorldTurnIfDue: vi.fn() }))

import { requireAuth } from '@/lib/auth'
import { getCampaignMembership } from '@/lib/db/campaignAccess'
import { prisma } from '@/lib/prisma'
import PusherServer from '@/lib/realtime/pusher-server'
import { checkRateLimit, rateLimitExceededResponse } from '@/lib/rateLimit'
import { preflightSceneBilling, chargeForSceneResolution } from '@/lib/game/resolutionBilling'
import { resolveScene } from '@/lib/game/sceneResolver'
import { runWorldTurnIfDue } from '@/lib/game/worldTurn'
import { POST } from '../route'

const db = prisma as any

function req(body: unknown) {
  return new NextRequest('http://localhost/api/campaigns/camp1/end-scene', {
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
  ;(preflightSceneBilling as any).mockResolvedValue({ ok: true })
  ;(chargeForSceneResolution as any).mockResolvedValue({ ok: true })
  ;(PusherServer as any).mockReturnValue(null)
  db.scene.update.mockResolvedValue({ id: 'scene1' })
})

describe('POST', () => {
  it('rejects an unauthenticated request', async () => {
    ;(requireAuth as any).mockRejectedValue(new Error('Unauthorized'))
    const response = await POST(req({ sceneId: 'scene1' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(401)
  })

  it('is rate limited before touching the DB', async () => {
    ;(checkRateLimit as any).mockResolvedValue({ allowed: false, retryAfterSeconds: 5 })
    ;(rateLimitExceededResponse as any).mockReturnValue(new Response(null, { status: 429 }))
    const response = await POST(req({ sceneId: 'scene1' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(429)
    expect(db.scene.findUnique).not.toHaveBeenCalled()
  })

  it('rejects a non-member', async () => {
    ;(getCampaignMembership as any).mockResolvedValue(null)
    const response = await POST(req({ sceneId: 'scene1' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
  })

  it('404s when the scene does not exist or belongs to a different campaign', async () => {
    db.scene.findUnique.mockResolvedValue({ id: 'scene1', campaignId: 'other-camp', playerActions: [] })
    const response = await POST(req({ sceneId: 'scene1' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(404)
  })

  it('rejects ending an already-resolved scene', async () => {
    db.scene.findUnique.mockResolvedValue({ id: 'scene1', campaignId: 'camp1', status: 'RESOLVED', playerActions: [] })
    const response = await POST(req({ sceneId: 'scene1' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(400)
    expect(db.scene.update).not.toHaveBeenCalled()
  })

  it('rejects with 402 when the billing preflight fails', async () => {
    db.scene.findUnique.mockResolvedValue({ id: 'scene1', campaignId: 'camp1', status: 'AWAITING_ACTIONS', playerActions: [] })
    ;(preflightSceneBilling as any).mockResolvedValue({ ok: false, error: 'Insufficient balance' })
    const response = await POST(req({ sceneId: 'scene1' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(402)
    expect(db.scene.update).not.toHaveBeenCalled()
  })

  it('skips final resolution when the scene has no pending actions', async () => {
    db.scene.findUnique.mockResolvedValue({ id: 'scene1', campaignId: 'camp1', status: 'AWAITING_ACTIONS', playerActions: [], sceneNumber: 3 })
    const response = await POST(req({ sceneId: 'scene1' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(200)
    expect(resolveScene).not.toHaveBeenCalled()
    expect(db.scene.update).toHaveBeenCalledWith({ where: { id: 'scene1' }, data: { status: 'RESOLVED' } })
  })

  it('triggers final resolution and the world turn when actions are pending', async () => {
    db.scene.findUnique.mockResolvedValue({ id: 'scene1', campaignId: 'camp1', status: 'AWAITING_ACTIONS', playerActions: [{ id: 'a1' }], sceneNumber: 3 })
    ;(resolveScene as any).mockResolvedValue(undefined)
    ;(runWorldTurnIfDue as any).mockResolvedValue({ ran: true })

    const response = await POST(req({ sceneId: 'scene1' }), { params: { id: 'camp1' } })

    expect(response.status).toBe(200)
    // forceResolve:true + isSceneEnding:true — ending explicitly always
    // proceeds even with unsubmitted actions, and signals the model that
    // this is the scene's definitive final exchange (see scenePrompt.ts's
    // <scene_ending> section), instead of silently flipping to RESOLVED
    // with no real narration if resolution would otherwise have thrown.
    expect(resolveScene).toHaveBeenCalledWith('camp1', 'scene1', true, true)
    expect(runWorldTurnIfDue).toHaveBeenCalledWith('camp1')
  })

  it('still marks the scene RESOLVED even when final resolution throws', async () => {
    db.scene.findUnique.mockResolvedValue({ id: 'scene1', campaignId: 'camp1', status: 'AWAITING_ACTIONS', playerActions: [{ id: 'a1' }], sceneNumber: 3 })
    ;(resolveScene as any).mockRejectedValue(new Error('AI call failed'))

    const response = await POST(req({ sceneId: 'scene1' }), { params: { id: 'camp1' } })

    expect(response.status).toBe(200)
    expect(db.scene.update).toHaveBeenCalledWith({ where: { id: 'scene1' }, data: { status: 'RESOLVED' } })
  })

  it('still succeeds even when the metered charge fails (best-effort)', async () => {
    db.scene.findUnique.mockResolvedValue({ id: 'scene1', campaignId: 'camp1', status: 'AWAITING_ACTIONS', playerActions: [], sceneNumber: 3 })
    ;(chargeForSceneResolution as any).mockResolvedValue({ ok: false, error: 'balance ran out' })

    const response = await POST(req({ sceneId: 'scene1' }), { params: { id: 'camp1' } })

    expect(response.status).toBe(200)
  })

  it('returns 500 on an unexpected error', async () => {
    db.scene.findUnique.mockRejectedValue(new Error('db down'))
    const response = await POST(req({ sceneId: 'scene1' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(500)
  })
})
