// src/app/api/campaigns/[id]/maps/active/__tests__/route.test.ts
// #135 (cont.) — the active-map read/set route had no test coverage:
// GET's plain membership gate vs. PUT's admin-only gate, and that PUT
// verifies the target map actually belongs to this campaign before
// activating it (not just that some map with that id exists anywhere),
// were both unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ getUser: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({ getCampaignMembership: vi.fn() }))
vi.mock('@/lib/maps/map-service', () => ({
  MapService: { getActiveMap: vi.fn(), getMapById: vi.fn(), setActiveMap: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({
  prisma: { campaignMembership: { findFirst: vi.fn() } },
}))

import { getUser } from '@/lib/auth'
import { getCampaignMembership } from '@/lib/db/campaignAccess'
import { MapService } from '@/lib/maps/map-service'
import { prisma } from '@/lib/prisma'
import { GET, PUT } from '../route'

const db = prisma as any

function getRequest() {
  return new NextRequest('http://localhost/api/campaigns/camp1/maps/active')
}

function putRequest(body: unknown) {
  return new NextRequest('http://localhost/api/campaigns/camp1/maps/active', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getUser as any).mockResolvedValue({ userId: 'admin1' })
  ;(getCampaignMembership as any).mockResolvedValue({ role: 'PLAYER' })
})

describe('GET', () => {
  it('rejects a non-member', async () => {
    ;(getCampaignMembership as any).mockResolvedValue(null)
    const response = await GET(getRequest(), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
  })

  it('returns null when there is no active map', async () => {
    ;(MapService.getActiveMap as any).mockResolvedValue(null)
    const response = await GET(getRequest(), { params: { id: 'camp1' } })
    const body = await response.json()
    expect(body).toEqual({ map: null })
  })

  it('returns the active map', async () => {
    ;(MapService.getActiveMap as any).mockResolvedValue({ id: 'm1' })
    const response = await GET(getRequest(), { params: { id: 'camp1' } })
    const body = await response.json()
    expect(body).toEqual({ map: { id: 'm1' } })
  })
})

describe('PUT', () => {
  it('rejects a non-admin', async () => {
    db.campaignMembership.findFirst.mockResolvedValue(null)
    const response = await PUT(putRequest({ mapId: 'm1' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
    expect(MapService.setActiveMap).not.toHaveBeenCalled()
  })

  it('requires mapId', async () => {
    db.campaignMembership.findFirst.mockResolvedValue({ role: 'ADMIN' })
    const response = await PUT(putRequest({}), { params: { id: 'camp1' } })
    expect(response.status).toBe(400)
  })

  it('404s for a map that belongs to a different campaign', async () => {
    db.campaignMembership.findFirst.mockResolvedValue({ role: 'ADMIN' })
    ;(MapService.getMapById as any).mockResolvedValue({ id: 'm1', campaignId: 'other-camp' })
    const response = await PUT(putRequest({ mapId: 'm1' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(404)
    expect(MapService.setActiveMap).not.toHaveBeenCalled()
  })

  it('sets the active map for a valid same-campaign map', async () => {
    db.campaignMembership.findFirst.mockResolvedValue({ role: 'ADMIN' })
    ;(MapService.getMapById as any).mockResolvedValue({ id: 'm1', campaignId: 'camp1' })
    const response = await PUT(putRequest({ mapId: 'm1' }), { params: { id: 'camp1' } })
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body).toEqual({ success: true })
    expect(MapService.setActiveMap).toHaveBeenCalledWith('camp1', 'm1')
  })
})
