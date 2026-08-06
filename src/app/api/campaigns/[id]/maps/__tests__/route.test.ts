// src/app/api/campaigns/[id]/maps/__tests__/route.test.ts
// #135 (cont.) — the map list/create route had no test coverage: the
// membership gate on both verbs (any member can create a map — shared
// table content, not a GM power, since there is no human GM in this
// product) was unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ getUser: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({ getCampaignMembership: vi.fn() }))
vi.mock('@/lib/maps/map-service', () => ({
  MapService: { getMaps: vi.fn(), createMap: vi.fn() },
}))

import { getUser } from '@/lib/auth'
import { getCampaignMembership } from '@/lib/db/campaignAccess'
import { MapService } from '@/lib/maps/map-service'
import { GET, POST } from '../route'

function getRequest() {
  return new NextRequest('http://localhost/api/campaigns/camp1/maps')
}

function postRequest(body: unknown) {
  return new NextRequest('http://localhost/api/campaigns/camp1/maps', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getUser as any).mockResolvedValue({ userId: 'player1' })
  ;(getCampaignMembership as any).mockResolvedValue({ role: 'PLAYER' })
  ;(MapService.getMaps as any).mockResolvedValue([])
})

describe('GET', () => {
  it('rejects an unauthenticated request', async () => {
    ;(getUser as any).mockResolvedValue(null)
    const response = await GET(getRequest(), { params: { id: 'camp1' } })
    expect(response.status).toBe(401)
  })

  it('rejects a non-member', async () => {
    ;(getCampaignMembership as any).mockResolvedValue(null)
    const response = await GET(getRequest(), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
  })

  it('returns the campaign maps', async () => {
    ;(MapService.getMaps as any).mockResolvedValue([{ id: 'm1' }])
    const response = await GET(getRequest(), { params: { id: 'camp1' } })
    const body = await response.json()
    expect(body.maps).toEqual([{ id: 'm1' }])
  })
})

describe('POST', () => {
  it('rejects a non-member', async () => {
    ;(getCampaignMembership as any).mockResolvedValue(null)
    const response = await POST(postRequest({ name: 'Map' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
    expect(MapService.createMap).not.toHaveBeenCalled()
  })

  it('lets any member create a map, not just an admin', async () => {
    ;(MapService.createMap as any).mockResolvedValue({ id: 'm1', name: 'Map' })
    const response = await POST(postRequest({ name: 'Map', width: 10, height: 10, gridSize: 1, background: 'url', sceneId: 's1' }), { params: { id: 'camp1' } })
    const body = await response.json()
    expect(response.status).toBe(201)
    expect(body.map).toEqual({ id: 'm1', name: 'Map' })
    expect(MapService.createMap).toHaveBeenCalledWith('camp1', expect.objectContaining({
      name: 'Map', imageUrl: 'url', sessionId: 's1',
    }))
  })
})
