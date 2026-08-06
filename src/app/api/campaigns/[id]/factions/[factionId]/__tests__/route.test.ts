// src/app/api/campaigns/[id]/factions/[factionId]/__tests__/route.test.ts
// #133 — individual faction PATCH/DELETE had no test coverage: the admin
// gate, and PATCH's leader-demotion side effect (assigning a PC leader
// must demote any existing NPC LEADER to MEMBER so the two never conflict),
// were both unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ getUser: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({ requireCampaignAdmin: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    faction: { update: vi.fn(), delete: vi.fn() },
    nPC: { updateMany: vi.fn() },
  },
}))

import { getUser } from '@/lib/auth'
import { requireCampaignAdmin } from '@/lib/db/campaignAccess'
import { prisma } from '@/lib/prisma'
import { PATCH, DELETE } from '../route'

const db = prisma as any

function patchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/campaigns/camp1/factions/faction1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function deleteRequest() {
  return new NextRequest('http://localhost/api/campaigns/camp1/factions/faction1', { method: 'DELETE' })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getUser as any).mockResolvedValue({ userId: 'admin1', email: 'admin1@example.com' })
  ;(requireCampaignAdmin as any).mockResolvedValue({ membership: { role: 'ADMIN' } })
})

describe('PATCH', () => {
  it('rejects an unauthenticated request', async () => {
    ;(getUser as any).mockResolvedValue(null)
    const response = await PATCH(patchRequest({ name: 'New Name' }), { params: { id: 'camp1', factionId: 'faction1' } })
    expect(response.status).toBe(401)
    expect(db.faction.update).not.toHaveBeenCalled()
  })

  it('rejects a non-admin', async () => {
    ;(requireCampaignAdmin as any).mockResolvedValue({ response: new Response(null, { status: 403 }) })
    const response = await PATCH(patchRequest({ name: 'New Name' }), { params: { id: 'camp1', factionId: 'faction1' } })
    expect(response.status).toBe(403)
    expect(db.faction.update).not.toHaveBeenCalled()
    expect(db.nPC.updateMany).not.toHaveBeenCalled()
  })

  it('demotes any existing NPC leader when a PC leader is assigned', async () => {
    db.faction.update.mockResolvedValue({ id: 'faction1' })

    await PATCH(patchRequest({ leaderCharacterId: 'char1' }), { params: { id: 'camp1', factionId: 'faction1' } })

    expect(db.nPC.updateMany).toHaveBeenCalledWith({
      where: { factionId: 'faction1', factionRole: 'LEADER' },
      data: { factionRole: 'MEMBER' },
    })
    expect(db.faction.update).toHaveBeenCalledWith({
      where: { id: 'faction1', campaignId: 'camp1' },
      data: expect.objectContaining({ leaderCharacterId: 'char1' }),
    })
  })

  it('does not touch NPC leadership when no PC leader is being assigned', async () => {
    db.faction.update.mockResolvedValue({ id: 'faction1' })
    await PATCH(patchRequest({ name: 'Renamed Guild' }), { params: { id: 'camp1', factionId: 'faction1' } })
    expect(db.nPC.updateMany).not.toHaveBeenCalled()
  })

  it('returns 500 on an unexpected error', async () => {
    db.faction.update.mockRejectedValue(new Error('db down'))
    const response = await PATCH(patchRequest({ name: 'New Name' }), { params: { id: 'camp1', factionId: 'faction1' } })
    expect(response.status).toBe(500)
  })
})

describe('DELETE', () => {
  it('rejects an unauthenticated request', async () => {
    ;(getUser as any).mockResolvedValue(null)
    const response = await DELETE(deleteRequest(), { params: { id: 'camp1', factionId: 'faction1' } })
    expect(response.status).toBe(401)
    expect(db.faction.delete).not.toHaveBeenCalled()
  })

  it('rejects a non-admin', async () => {
    ;(requireCampaignAdmin as any).mockResolvedValue({ response: new Response(null, { status: 403 }) })
    const response = await DELETE(deleteRequest(), { params: { id: 'camp1', factionId: 'faction1' } })
    expect(response.status).toBe(403)
    expect(db.faction.delete).not.toHaveBeenCalled()
  })

  it('deletes the faction scoped to its campaign', async () => {
    db.faction.delete.mockResolvedValue({ id: 'faction1' })
    const response = await DELETE(deleteRequest(), { params: { id: 'camp1', factionId: 'faction1' } })
    expect(response.status).toBe(200)
    expect(db.faction.delete).toHaveBeenCalledWith({ where: { id: 'faction1', campaignId: 'camp1' } })
  })
})
