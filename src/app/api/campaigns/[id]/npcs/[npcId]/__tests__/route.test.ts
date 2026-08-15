// src/app/api/campaigns/[id]/npcs/[npcId]/__tests__/route.test.ts
// #133 — individual NPC PATCH/DELETE had no test coverage: the admin gate,
// and PATCH's location-resolution branch (currentLocation present vs.
// omitted), were both unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ getUser: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({ requireCampaignAdmin: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    nPC: { update: vi.fn(), delete: vi.fn() },
  },
}))
vi.mock('@/lib/game/worldUpdaters/locations', () => ({ resolveOrCreateLocationId: vi.fn() }))
vi.mock('@/lib/game/leadershipGuard', () => ({ guardNpcLeaderAssignment: vi.fn() }))

import { getUser } from '@/lib/auth'
import { requireCampaignAdmin } from '@/lib/db/campaignAccess'
import { prisma } from '@/lib/prisma'
import { resolveOrCreateLocationId } from '@/lib/game/worldUpdaters/locations'
import { guardNpcLeaderAssignment } from '@/lib/game/leadershipGuard'
import { PATCH, DELETE } from '../route'

const db = prisma as any

function patchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/campaigns/camp1/npcs/npc1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function deleteRequest() {
  return new NextRequest('http://localhost/api/campaigns/camp1/npcs/npc1', { method: 'DELETE' })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getUser as any).mockResolvedValue({ userId: 'admin1', email: 'admin1@example.com' })
  ;(requireCampaignAdmin as any).mockResolvedValue({ membership: { role: 'ADMIN' } })
  ;(guardNpcLeaderAssignment as any).mockResolvedValue({ ok: true })
})

describe('PATCH', () => {
  it('rejects an unauthenticated request', async () => {
    ;(getUser as any).mockResolvedValue(null)
    const response = await PATCH(patchRequest({ name: 'New Name' }), { params: { id: 'camp1', npcId: 'npc1' } })
    expect(response.status).toBe(401)
    expect(db.nPC.update).not.toHaveBeenCalled()
  })

  it('rejects a non-admin', async () => {
    ;(requireCampaignAdmin as any).mockResolvedValue({ response: new Response(null, { status: 403 }) })
    const response = await PATCH(patchRequest({ name: 'New Name' }), { params: { id: 'camp1', npcId: 'npc1' } })
    expect(response.status).toBe(403)
    expect(db.nPC.update).not.toHaveBeenCalled()
    expect(resolveOrCreateLocationId).not.toHaveBeenCalled()
  })

  it('updates without touching location resolution when currentLocation is omitted', async () => {
    db.nPC.update.mockResolvedValue({ id: 'npc1', name: 'New Name' })

    const response = await PATCH(patchRequest({ name: 'New Name' }), { params: { id: 'camp1', npcId: 'npc1' } })

    expect(response.status).toBe(200)
    expect(resolveOrCreateLocationId).not.toHaveBeenCalled()
    expect(db.nPC.update).toHaveBeenCalledWith({
      where: { id: 'npc1', campaignId: 'camp1' },
      data: expect.objectContaining({ name: 'New Name', locationId: undefined }),
    })
  })

  it('resolves/creates the matching Location row when currentLocation is provided', async () => {
    ;(resolveOrCreateLocationId as any).mockResolvedValue('loc-42')
    db.nPC.update.mockResolvedValue({ id: 'npc1' })

    await PATCH(patchRequest({ currentLocation: 'Ashcrown Hold', isDiscovered: true }), { params: { id: 'camp1', npcId: 'npc1' } })

    expect(resolveOrCreateLocationId).toHaveBeenCalledWith(prisma, 'camp1', 'Ashcrown Hold', true)
    expect(db.nPC.update).toHaveBeenCalledWith({
      where: { id: 'npc1', campaignId: 'camp1' },
      data: expect.objectContaining({ currentLocation: 'Ashcrown Hold', locationId: 'loc-42' }),
    })
  })

  it('clears factionRole when factionId is unset', async () => {
    db.nPC.update.mockResolvedValue({ id: 'npc1' })

    await PATCH(patchRequest({ factionId: null }), { params: { id: 'camp1', npcId: 'npc1' } })

    expect(db.nPC.update).toHaveBeenCalledWith({
      where: { id: 'npc1', campaignId: 'camp1' },
      data: expect.objectContaining({ factionId: null, factionRole: null }),
    })
  })

  it('defaults factionRole to MEMBER when a faction is assigned without a role', async () => {
    db.nPC.update.mockResolvedValue({ id: 'npc1' })

    await PATCH(patchRequest({ factionId: 'faction1' }), { params: { id: 'camp1', npcId: 'npc1' } })

    expect(db.nPC.update).toHaveBeenCalledWith({
      where: { id: 'npc1', campaignId: 'camp1' },
      data: expect.objectContaining({ factionId: 'faction1', factionRole: 'MEMBER' }),
    })
  })

  it('returns 500 on an unexpected error', async () => {
    db.nPC.update.mockRejectedValue(new Error('db down'))
    const response = await PATCH(patchRequest({ name: 'New Name' }), { params: { id: 'camp1', npcId: 'npc1' } })
    expect(response.status).toBe(500)
  })

  // #275: the update route needed the same "at most one leader either way"
  // cross-check the create route now has — an existing NPC being promoted
  // to LEADER is just as capable of colliding with a PC leader or another
  // living NPC LEADER as a newly created one is.
  it('#275: does not check leadership when factionRole is not LEADER', async () => {
    db.nPC.update.mockResolvedValue({ id: 'npc1' })
    await PATCH(patchRequest({ factionId: 'f1', factionRole: 'MEMBER' }), { params: { id: 'camp1', npcId: 'npc1' } })
    expect(guardNpcLeaderAssignment).not.toHaveBeenCalled()
  })

  it('#275: guards a LEADER assignment, excluding this NPC itself from the conflict check', async () => {
    db.nPC.update.mockResolvedValue({ id: 'npc1' })
    await PATCH(patchRequest({ factionId: 'f1', factionRole: 'LEADER' }), { params: { id: 'camp1', npcId: 'npc1' } })
    expect(guardNpcLeaderAssignment).toHaveBeenCalledWith('camp1', 'f1', 'npc1')
    expect(db.nPC.update).toHaveBeenCalled()
  })

  it('#275: rejects the update when the leadership guard fails, e.g. a PC already leads the faction', async () => {
    ;(guardNpcLeaderAssignment as any).mockResolvedValue({ ok: false, error: 'This faction already has a player-character leader.' })
    const response = await PATCH(patchRequest({ factionId: 'f1', factionRole: 'LEADER' }), { params: { id: 'camp1', npcId: 'npc1' } })
    expect(response.status).toBe(400)
    expect(db.nPC.update).not.toHaveBeenCalled()
  })
})

describe('DELETE', () => {
  it('rejects an unauthenticated request', async () => {
    ;(getUser as any).mockResolvedValue(null)
    const response = await DELETE(deleteRequest(), { params: { id: 'camp1', npcId: 'npc1' } })
    expect(response.status).toBe(401)
    expect(db.nPC.delete).not.toHaveBeenCalled()
  })

  it('rejects a non-admin', async () => {
    ;(requireCampaignAdmin as any).mockResolvedValue({ response: new Response(null, { status: 403 }) })
    const response = await DELETE(deleteRequest(), { params: { id: 'camp1', npcId: 'npc1' } })
    expect(response.status).toBe(403)
    expect(db.nPC.delete).not.toHaveBeenCalled()
  })

  it('deletes the NPC scoped to its campaign', async () => {
    db.nPC.delete.mockResolvedValue({ id: 'npc1' })
    const response = await DELETE(deleteRequest(), { params: { id: 'camp1', npcId: 'npc1' } })
    expect(response.status).toBe(200)
    expect(db.nPC.delete).toHaveBeenCalledWith({ where: { id: 'npc1', campaignId: 'camp1' } })
  })
})
