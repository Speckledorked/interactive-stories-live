// src/app/api/campaigns/[id]/locations/[locationId]/__tests__/route.test.ts
// #133 — individual location PATCH/DELETE had no test coverage: the admin
// gate, and PATCH's ownerFactionId-falsy-to-null normalization, were both
// unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ getUser: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({ requireCampaignAdmin: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    location: { update: vi.fn(), delete: vi.fn() },
  },
}))

import { getUser } from '@/lib/auth'
import { requireCampaignAdmin } from '@/lib/db/campaignAccess'
import { prisma } from '@/lib/prisma'
import { PATCH, DELETE } from '../route'

const db = prisma as any

function patchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/campaigns/camp1/locations/loc1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function deleteRequest() {
  return new NextRequest('http://localhost/api/campaigns/camp1/locations/loc1', { method: 'DELETE' })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getUser as any).mockResolvedValue({ userId: 'admin1', email: 'admin1@example.com' })
  ;(requireCampaignAdmin as any).mockResolvedValue({ membership: { role: 'ADMIN' } })
})

describe('PATCH', () => {
  it('rejects an unauthenticated request', async () => {
    ;(getUser as any).mockResolvedValue(null)
    const response = await PATCH(patchRequest({ name: 'New Name' }), { params: { id: 'camp1', locationId: 'loc1' } })
    expect(response.status).toBe(401)
    expect(db.location.update).not.toHaveBeenCalled()
  })

  it('rejects a non-admin', async () => {
    ;(requireCampaignAdmin as any).mockResolvedValue({ response: new Response(null, { status: 403 }) })
    const response = await PATCH(patchRequest({ name: 'New Name' }), { params: { id: 'camp1', locationId: 'loc1' } })
    expect(response.status).toBe(403)
    expect(db.location.update).not.toHaveBeenCalled()
  })

  it('updates the location scoped to its campaign', async () => {
    db.location.update.mockResolvedValue({ id: 'loc1', name: 'New Name' })

    const response = await PATCH(patchRequest({ name: 'New Name', ownerFactionId: 'faction1' }), { params: { id: 'camp1', locationId: 'loc1' } })

    expect(response.status).toBe(200)
    expect(db.location.update).toHaveBeenCalledWith({
      where: { id: 'loc1', campaignId: 'camp1' },
      data: expect.objectContaining({ name: 'New Name', ownerFactionId: 'faction1' }),
    })
  })

  it('normalizes a falsy ownerFactionId to null instead of leaving it unset', async () => {
    db.location.update.mockResolvedValue({ id: 'loc1' })
    await PATCH(patchRequest({ ownerFactionId: '' }), { params: { id: 'camp1', locationId: 'loc1' } })
    expect(db.location.update).toHaveBeenCalledWith({
      where: { id: 'loc1', campaignId: 'camp1' },
      data: expect.objectContaining({ ownerFactionId: null }),
    })
  })

  it('returns 500 on an unexpected error', async () => {
    db.location.update.mockRejectedValue(new Error('db down'))
    const response = await PATCH(patchRequest({ name: 'New Name' }), { params: { id: 'camp1', locationId: 'loc1' } })
    expect(response.status).toBe(500)
  })
})

describe('DELETE', () => {
  it('rejects an unauthenticated request', async () => {
    ;(getUser as any).mockResolvedValue(null)
    const response = await DELETE(deleteRequest(), { params: { id: 'camp1', locationId: 'loc1' } })
    expect(response.status).toBe(401)
    expect(db.location.delete).not.toHaveBeenCalled()
  })

  it('rejects a non-admin', async () => {
    ;(requireCampaignAdmin as any).mockResolvedValue({ response: new Response(null, { status: 403 }) })
    const response = await DELETE(deleteRequest(), { params: { id: 'camp1', locationId: 'loc1' } })
    expect(response.status).toBe(403)
    expect(db.location.delete).not.toHaveBeenCalled()
  })

  it('deletes the location scoped to its campaign', async () => {
    db.location.delete.mockResolvedValue({ id: 'loc1' })
    const response = await DELETE(deleteRequest(), { params: { id: 'camp1', locationId: 'loc1' } })
    expect(response.status).toBe(200)
    expect(db.location.delete).toHaveBeenCalledWith({ where: { id: 'loc1', campaignId: 'camp1' } })
  })
})
