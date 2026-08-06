// src/app/api/campaigns/[id]/turns/__tests__/route.test.ts
// #133 — the turn-order route (GET/POST/DELETE) had no test coverage: the
// membership gate, the host-only skip-turn restriction, the best-effort
// (non-blocking) Pusher broadcast, and the two named-error-to-status
// mappings were all unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ verifyAuth: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({ getCampaignMembership: vi.fn() }))
vi.mock('@/lib/notifications/turn-tracker', () => ({
  TurnTracker: {
    initializeScene: vi.fn(),
    advanceTurn: vi.fn(),
    skipTurn: vi.fn(),
    getCurrentTurn: vi.fn(),
    endScene: vi.fn(),
  },
}))
vi.mock('@/lib/realtime/pusher-server', () => ({ PusherServer: vi.fn() }))

import { verifyAuth } from '@/lib/auth'
import { getCampaignMembership } from '@/lib/db/campaignAccess'
import { TurnTracker } from '@/lib/notifications/turn-tracker'
import { PusherServer } from '@/lib/realtime/pusher-server'
import { GET, POST, DELETE } from '../route'

const tracker = TurnTracker as any

function getRequest(sceneId?: string) {
  const url = sceneId ? `http://localhost/api/campaigns/camp1/turns?sceneId=${sceneId}` : 'http://localhost/api/campaigns/camp1/turns'
  return new NextRequest(url)
}

function postRequest(body: unknown) {
  return new NextRequest('http://localhost/api/campaigns/camp1/turns', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function deleteRequest(sceneId?: string) {
  const url = sceneId ? `http://localhost/api/campaigns/camp1/turns?sceneId=${sceneId}` : 'http://localhost/api/campaigns/camp1/turns'
  return new NextRequest(url, { method: 'DELETE' })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(verifyAuth as any).mockResolvedValue({ userId: 'player1' })
  ;(getCampaignMembership as any).mockResolvedValue({ role: 'PLAYER' })
  ;(PusherServer as any).mockReturnValue(null)
})

describe('GET', () => {
  it('rejects an unauthenticated request', async () => {
    ;(verifyAuth as any).mockResolvedValue(null)
    const response = await GET(getRequest('scene1'), { params: { id: 'camp1' } })
    expect(response.status).toBe(401)
  })

  it('requires a sceneId', async () => {
    const response = await GET(getRequest(), { params: { id: 'camp1' } })
    expect(response.status).toBe(400)
  })

  it('rejects a non-member', async () => {
    ;(getCampaignMembership as any).mockResolvedValue(null)
    const response = await GET(getRequest('scene1'), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
  })

  it('returns the current turn info', async () => {
    tracker.getCurrentTurn.mockResolvedValue({ currentPlayerId: 'player1' })
    const response = await GET(getRequest('scene1'), { params: { id: 'camp1' } })
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.turnInfo).toEqual({ currentPlayerId: 'player1' })
    expect(tracker.getCurrentTurn).toHaveBeenCalledWith('camp1', 'scene1')
  })
})

describe('POST', () => {
  it('rejects an unauthenticated request', async () => {
    ;(verifyAuth as any).mockResolvedValue(null)
    const response = await POST(postRequest({ action: 'advance', sceneId: 'scene1' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(401)
  })

  it('rejects an invalid action', async () => {
    const response = await POST(postRequest({ action: 'teleport', sceneId: 'scene1' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(400)
  })

  it('requires a sceneId', async () => {
    const response = await POST(postRequest({ action: 'advance' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(400)
  })

  it('rejects a non-member', async () => {
    ;(getCampaignMembership as any).mockResolvedValue(null)
    const response = await POST(postRequest({ action: 'advance', sceneId: 'scene1' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
  })

  it('requires participants to initialize a scene', async () => {
    const response = await POST(postRequest({ action: 'initialize', sceneId: 'scene1' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(400)
    expect(tracker.initializeScene).not.toHaveBeenCalled()
  })

  it('initializes a scene with the given participants', async () => {
    tracker.initializeScene.mockResolvedValue({ ok: true })
    tracker.getCurrentTurn.mockResolvedValue({ currentPlayerId: 'p1' })
    const response = await POST(
      postRequest({ action: 'initialize', sceneId: 'scene1', participants: ['p1', 'p2'], turnTimeoutMinutes: 30 }),
      { params: { id: 'camp1' } }
    )
    expect(response.status).toBe(200)
    expect(tracker.initializeScene).toHaveBeenCalledWith('camp1', 'scene1', ['p1', 'p2'], 30)
  })

  it('advances the turn', async () => {
    tracker.advanceTurn.mockResolvedValue({ ok: true })
    tracker.getCurrentTurn.mockResolvedValue({ currentPlayerId: 'p2' })
    const response = await POST(postRequest({ action: 'advance', sceneId: 'scene1' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(200)
    expect(tracker.advanceTurn).toHaveBeenCalledWith('camp1', 'scene1', 'player1')
  })

  it('rejects a non-admin trying to skip another player\'s turn', async () => {
    const response = await POST(postRequest({ action: 'skip', sceneId: 'scene1' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
    expect(tracker.skipTurn).not.toHaveBeenCalled()
  })

  it('lets the host skip a turn', async () => {
    ;(getCampaignMembership as any).mockResolvedValue({ role: 'ADMIN' })
    tracker.skipTurn.mockResolvedValue({ ok: true })
    tracker.getCurrentTurn.mockResolvedValue({ currentPlayerId: 'p3' })
    const response = await POST(postRequest({ action: 'skip', sceneId: 'scene1' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(200)
    expect(tracker.skipTurn).toHaveBeenCalledWith('camp1', 'scene1', 'Skipped by the host')
  })

  it('broadcasts the fresh turn state over Pusher when configured', async () => {
    const trigger = vi.fn().mockResolvedValue(undefined)
    ;(PusherServer as any).mockReturnValue({ trigger })
    tracker.advanceTurn.mockResolvedValue({ ok: true })
    tracker.getCurrentTurn.mockResolvedValue({ currentPlayerId: 'p2' })

    await POST(postRequest({ action: 'advance', sceneId: 'scene1' }), { params: { id: 'camp1' } })

    expect(trigger).toHaveBeenCalledWith('campaign-camp1', 'turn-update', { currentPlayerId: 'p2' })
  })

  it('still succeeds when the Pusher broadcast fails (non-critical)', async () => {
    ;(PusherServer as any).mockReturnValue({ trigger: vi.fn().mockRejectedValue(new Error('pusher down')) })
    tracker.advanceTurn.mockResolvedValue({ ok: true })
    tracker.getCurrentTurn.mockResolvedValue({ currentPlayerId: 'p2' })

    const response = await POST(postRequest({ action: 'advance', sceneId: 'scene1' }), { params: { id: 'camp1' } })

    expect(response.status).toBe(200)
  })

  it('maps a "Not your turn" error to 400', async () => {
    tracker.advanceTurn.mockRejectedValue(new Error('Not your turn'))
    const response = await POST(postRequest({ action: 'advance', sceneId: 'scene1' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(400)
  })

  it('maps a "Turn tracker not found" error to 404', async () => {
    tracker.advanceTurn.mockRejectedValue(new Error('Turn tracker not found'))
    const response = await POST(postRequest({ action: 'advance', sceneId: 'scene1' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(404)
  })

  it('maps an unrecognized error to 500', async () => {
    tracker.advanceTurn.mockRejectedValue(new Error('something else broke'))
    const response = await POST(postRequest({ action: 'advance', sceneId: 'scene1' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(500)
  })
})

describe('DELETE', () => {
  it('rejects an unauthenticated request', async () => {
    ;(verifyAuth as any).mockResolvedValue(null)
    const response = await DELETE(deleteRequest('scene1'), { params: { id: 'camp1' } })
    expect(response.status).toBe(401)
  })

  it('requires a sceneId', async () => {
    const response = await DELETE(deleteRequest(), { params: { id: 'camp1' } })
    expect(response.status).toBe(400)
  })

  it('rejects a non-member', async () => {
    ;(getCampaignMembership as any).mockResolvedValue(null)
    const response = await DELETE(deleteRequest('scene1'), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
    expect(tracker.endScene).not.toHaveBeenCalled()
  })

  it('lets any member end turn tracking for the scene', async () => {
    tracker.endScene.mockResolvedValue(undefined)
    const response = await DELETE(deleteRequest('scene1'), { params: { id: 'camp1' } })
    expect(response.status).toBe(200)
    expect(tracker.endScene).toHaveBeenCalledWith('camp1', 'scene1')
  })

  it('broadcasts a null turn-update payload over Pusher when configured', async () => {
    const trigger = vi.fn().mockResolvedValue(undefined)
    ;(PusherServer as any).mockReturnValue({ trigger })
    tracker.endScene.mockResolvedValue(undefined)

    await DELETE(deleteRequest('scene1'), { params: { id: 'camp1' } })

    expect(trigger).toHaveBeenCalledWith('campaign-camp1', 'turn-update', null)
  })
})
