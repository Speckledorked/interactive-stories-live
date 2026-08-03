// src/app/api/campaigns/[id]/scenes/[sceneId]/reset/__tests__/route.test.ts
// #93 — the admin-only destructive recovery path for a scene stuck in
// RESOLVING: deletes pending player actions and clears exchange state.
// Untested despite that.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({ requireCampaignAdmin: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    scene: { findUnique: vi.fn(), update: vi.fn() },
    playerAction: { deleteMany: vi.fn() },
  },
}))
vi.mock('@/lib/realtime/pusher-server', () => ({
  default: vi.fn(() => ({ trigger: vi.fn().mockResolvedValue(undefined) })),
}))

import { requireAuth } from '@/lib/auth'
import { requireCampaignAdmin } from '@/lib/db/campaignAccess'
import { prisma } from '@/lib/prisma'
import { POST } from '../route'

const db = prisma as any

function req() {
  return new NextRequest('http://localhost/api/campaigns/camp1/scenes/scene1/reset', { method: 'POST' })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(requireAuth as any).mockResolvedValue({ userId: 'admin1', email: 'admin@example.com' })
  ;(requireCampaignAdmin as any).mockResolvedValue({ membership: { role: 'ADMIN' } })
})

describe('POST', () => {
  it('rejects a non-admin', async () => {
    ;(requireCampaignAdmin as any).mockResolvedValue({ response: new Response(null, { status: 403 }) })
    const response = await POST(req(), { params: { id: 'camp1', sceneId: 'scene1' } })
    expect(response.status).toBe(403)
    expect(db.playerAction.deleteMany).not.toHaveBeenCalled()
  })

  it('404s when the scene does not exist', async () => {
    db.scene.findUnique.mockResolvedValue(null)
    const response = await POST(req(), { params: { id: 'camp1', sceneId: 'scene1' } })
    expect(response.status).toBe(404)
  })

  it('refuses a scene belonging to a different campaign', async () => {
    db.scene.findUnique.mockResolvedValue({ id: 'scene1', campaignId: 'other-camp', status: 'RESOLVING', sceneNumber: 1 })
    const response = await POST(req(), { params: { id: 'camp1', sceneId: 'scene1' } })
    expect(response.status).toBe(400)
    expect(db.playerAction.deleteMany).not.toHaveBeenCalled()
  })

  it('refuses to reset a scene that is not actually stuck', async () => {
    db.scene.findUnique.mockResolvedValue({ id: 'scene1', campaignId: 'camp1', status: 'AWAITING_ACTIONS', sceneNumber: 1 })
    const response = await POST(req(), { params: { id: 'camp1', sceneId: 'scene1' } })
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.currentStatus).toBe('AWAITING_ACTIONS')
    expect(db.playerAction.deleteMany).not.toHaveBeenCalled()
  })

  it('clears pending actions and resets a stuck scene', async () => {
    db.scene.findUnique.mockResolvedValue({ id: 'scene1', campaignId: 'camp1', status: 'RESOLVING', sceneNumber: 3 })
    db.playerAction.deleteMany.mockResolvedValue({ count: 2 })
    db.scene.update.mockResolvedValue({ id: 'scene1', status: 'AWAITING_ACTIONS' })

    const response = await POST(req(), { params: { id: 'camp1', sceneId: 'scene1' } })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(db.playerAction.deleteMany).toHaveBeenCalledWith({ where: { sceneId: 'scene1', status: 'pending' } })
    expect(db.scene.update).toHaveBeenCalledWith({
      where: { id: 'scene1' },
      data: expect.objectContaining({ status: 'AWAITING_ACTIONS' }),
    })
    expect(body.actionsCleared).toBe(2)
  })

  it('still succeeds even if the Pusher broadcast fails', async () => {
    const { default: PusherServer } = await import('@/lib/realtime/pusher-server')
    ;(PusherServer as any).mockReturnValueOnce({ trigger: vi.fn().mockRejectedValue(new Error('pusher down')) })
    db.scene.findUnique.mockResolvedValue({ id: 'scene1', campaignId: 'camp1', status: 'RESOLVING', sceneNumber: 3 })
    db.playerAction.deleteMany.mockResolvedValue({ count: 0 })
    db.scene.update.mockResolvedValue({ id: 'scene1', status: 'AWAITING_ACTIONS' })

    const response = await POST(req(), { params: { id: 'camp1', sceneId: 'scene1' } })

    expect(response.status).toBe(200)
  })
})
