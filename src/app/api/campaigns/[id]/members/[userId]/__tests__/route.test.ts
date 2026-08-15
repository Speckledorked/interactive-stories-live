// src/app/api/campaigns/[id]/members/[userId]/__tests__/route.test.ts
// #93 — untested despite carrying the "last admin" guard on both the
// remove and demote paths; a regression here either strands a campaign
// with zero admins or blocks a legitimate removal forever.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({
  requireCampaignAdmin: vi.fn(),
  getCampaignMembership: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaignMembership: { count: vi.fn(), delete: vi.fn(), update: vi.fn() },
    turnTracker: { findMany: vi.fn() },
  },
}))
vi.mock('@/lib/notifications/turn-tracker', () => ({
  TurnTracker: { removePlayerFromTurn: vi.fn().mockResolvedValue([]) },
}))

import { requireAuth } from '@/lib/auth'
import { requireCampaignAdmin, getCampaignMembership } from '@/lib/db/campaignAccess'
import { prisma } from '@/lib/prisma'
import { TurnTracker } from '@/lib/notifications/turn-tracker'
import { DELETE, PATCH } from '../route'

const db = prisma as any
const turnTracker = TurnTracker as any

function deleteRequest() {
  return new NextRequest('http://localhost/api/campaigns/camp1/members/user2', { method: 'DELETE' })
}

function patchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/campaigns/camp1/members/user2', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(requireAuth as any).mockResolvedValue({ userId: 'admin1', email: 'admin@example.com' })
  ;(requireCampaignAdmin as any).mockResolvedValue({ membership: { role: 'ADMIN' } })
  db.turnTracker.findMany.mockResolvedValue([])
  turnTracker.removePlayerFromTurn.mockResolvedValue([])
})

describe('DELETE', () => {
  it('rejects a non-admin', async () => {
    ;(requireCampaignAdmin as any).mockResolvedValue({ response: new Response(null, { status: 403 }) })
    const response = await DELETE(deleteRequest(), { params: { id: 'camp1', userId: 'user2' } })
    expect(response.status).toBe(403)
    expect(db.campaignMembership.delete).not.toHaveBeenCalled()
  })

  it('403s when the target is not a member', async () => {
    ;(getCampaignMembership as any).mockResolvedValue(null)
    const response = await DELETE(deleteRequest(), { params: { id: 'camp1', userId: 'user2' } })
    expect(response.status).toBe(403)
  })

  it('removes an ordinary player without checking the admin count', async () => {
    ;(getCampaignMembership as any).mockResolvedValue({ role: 'PLAYER' })
    const response = await DELETE(deleteRequest(), { params: { id: 'camp1', userId: 'user2' } })
    expect(response.status).toBe(200)
    expect(db.campaignMembership.count).not.toHaveBeenCalled()
    expect(db.campaignMembership.delete).toHaveBeenCalledWith({
      where: { userId_campaignId: { userId: 'user2', campaignId: 'camp1' } },
    })
  })

  it('refuses to remove the last admin', async () => {
    ;(getCampaignMembership as any).mockResolvedValue({ role: 'ADMIN' })
    db.campaignMembership.count.mockResolvedValue(1)
    const response = await DELETE(deleteRequest(), { params: { id: 'camp1', userId: 'user2' } })
    expect(response.status).toBe(400)
    expect(db.campaignMembership.delete).not.toHaveBeenCalled()
  })

  it('allows removing an admin when another admin remains', async () => {
    ;(getCampaignMembership as any).mockResolvedValue({ role: 'ADMIN' })
    db.campaignMembership.count.mockResolvedValue(2)
    const response = await DELETE(deleteRequest(), { params: { id: 'camp1', userId: 'user2' } })
    expect(response.status).toBe(200)
    expect(db.campaignMembership.delete).toHaveBeenCalled()
  })

  // #319: removePlayerFromTurn/addPlayerToTurn were fully built but called
  // from nowhere — a removed member's slot in an active scene's turnOrder
  // was never actually cleared, only made inaccessible to them.
  it('#319: drops the removed member from a scene turnOrder they are present in', async () => {
    ;(getCampaignMembership as any).mockResolvedValue({ role: 'PLAYER' })
    db.turnTracker.findMany.mockResolvedValue([
      { sceneId: 'scene1', turnOrder: [{ userId: 'user2', name: 'Bob' }, { userId: 'user3', name: 'Carol' }] },
    ])
    const response = await DELETE(deleteRequest(), { params: { id: 'camp1', userId: 'user2' } })
    expect(response.status).toBe(200)
    expect(turnTracker.removePlayerFromTurn).toHaveBeenCalledWith('camp1', 'scene1', 'user2')
  })

  it('#319: does not touch a turnTracker the removed member is not part of', async () => {
    ;(getCampaignMembership as any).mockResolvedValue({ role: 'PLAYER' })
    db.turnTracker.findMany.mockResolvedValue([
      { sceneId: 'scene1', turnOrder: [{ userId: 'user3', name: 'Carol' }] },
    ])
    const response = await DELETE(deleteRequest(), { params: { id: 'camp1', userId: 'user2' } })
    expect(response.status).toBe(200)
    expect(turnTracker.removePlayerFromTurn).not.toHaveBeenCalled()
  })

  it('#319: a failure clearing turn order does not fail the member removal itself', async () => {
    ;(getCampaignMembership as any).mockResolvedValue({ role: 'PLAYER' })
    db.turnTracker.findMany.mockResolvedValue([
      { sceneId: 'scene1', turnOrder: [{ userId: 'user2', name: 'Bob' }] },
    ])
    turnTracker.removePlayerFromTurn.mockRejectedValue(new Error('db down'))
    const response = await DELETE(deleteRequest(), { params: { id: 'camp1', userId: 'user2' } })
    expect(response.status).toBe(200)
    expect(db.campaignMembership.delete).toHaveBeenCalled()
  })
})

describe('PATCH', () => {
  it('rejects an invalid role before even checking admin status', async () => {
    const response = await PATCH(patchRequest({ role: 'SUPERUSER' }), { params: { id: 'camp1', userId: 'user2' } })
    expect(response.status).toBe(400)
    expect(requireCampaignAdmin).not.toHaveBeenCalled()
  })

  it('rejects a non-admin', async () => {
    ;(requireCampaignAdmin as any).mockResolvedValue({ response: new Response(null, { status: 403 }) })
    const response = await PATCH(patchRequest({ role: 'ADMIN' }), { params: { id: 'camp1', userId: 'user2' } })
    expect(response.status).toBe(403)
    expect(db.campaignMembership.update).not.toHaveBeenCalled()
  })

  it('403s when the target is not a member', async () => {
    ;(getCampaignMembership as any).mockResolvedValue(null)
    const response = await PATCH(patchRequest({ role: 'ADMIN' }), { params: { id: 'camp1', userId: 'user2' } })
    expect(response.status).toBe(403)
  })

  it('refuses to demote the last admin to PLAYER', async () => {
    ;(getCampaignMembership as any).mockResolvedValue({ role: 'ADMIN' })
    db.campaignMembership.count.mockResolvedValue(1)
    const response = await PATCH(patchRequest({ role: 'PLAYER' }), { params: { id: 'camp1', userId: 'user2' } })
    expect(response.status).toBe(400)
    expect(db.campaignMembership.update).not.toHaveBeenCalled()
  })

  it('allows demoting an admin when another admin remains', async () => {
    ;(getCampaignMembership as any).mockResolvedValue({ role: 'ADMIN' })
    db.campaignMembership.count.mockResolvedValue(2)
    db.campaignMembership.update.mockResolvedValue({ role: 'PLAYER' })
    const response = await PATCH(patchRequest({ role: 'PLAYER' }), { params: { id: 'camp1', userId: 'user2' } })
    expect(response.status).toBe(200)
    expect(db.campaignMembership.update).toHaveBeenCalled()
  })

  it('does not check the admin count when promoting a player to admin', async () => {
    ;(getCampaignMembership as any).mockResolvedValue({ role: 'PLAYER' })
    db.campaignMembership.update.mockResolvedValue({ role: 'ADMIN' })
    const response = await PATCH(patchRequest({ role: 'ADMIN' }), { params: { id: 'camp1', userId: 'user2' } })
    expect(response.status).toBe(200)
    expect(db.campaignMembership.count).not.toHaveBeenCalled()
  })
})
