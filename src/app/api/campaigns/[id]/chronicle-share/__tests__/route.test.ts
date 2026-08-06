// src/app/api/campaigns/[id]/chronicle-share/__tests__/route.test.ts
// #135 (cont.) — the public chronicle share-link toggle had no test
// coverage: the admin-only gate on all three verbs, that enabling mints a
// token and disabling clears it (not just flips a flag, so a later
// re-enable can't resurrect an old link), and that GET only returns the
// token while sharing is actually enabled, were all unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({ getCampaignMembership: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { campaign: { findUnique: vi.fn(), update: vi.fn() } },
}))

import { requireAuth } from '@/lib/auth'
import { getCampaignMembership } from '@/lib/db/campaignAccess'
import { prisma } from '@/lib/prisma'
import { GET, POST, DELETE } from '../route'

const db = prisma as any

function req() {
  return new NextRequest('http://localhost/api/campaigns/camp1/chronicle-share')
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(requireAuth as any).mockResolvedValue({ userId: 'admin1' })
  ;(getCampaignMembership as any).mockResolvedValue({ role: 'ADMIN' })
})

describe('GET', () => {
  it('rejects an unauthenticated request', async () => {
    ;(requireAuth as any).mockRejectedValue(new Error('Unauthorized'))
    const response = await GET(req(), { params: { id: 'camp1' } })
    expect(response.status).toBe(401)
  })

  it('rejects a non-admin', async () => {
    ;(getCampaignMembership as any).mockResolvedValue({ role: 'PLAYER' })
    const response = await GET(req(), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
  })

  it('returns 404 for a missing campaign', async () => {
    db.campaign.findUnique.mockResolvedValue(null)
    const response = await GET(req(), { params: { id: 'camp1' } })
    expect(response.status).toBe(404)
  })

  it('withholds the token while sharing is disabled', async () => {
    db.campaign.findUnique.mockResolvedValue({ chronicleShareEnabled: false, chronicleShareToken: 'stale-token' })
    const response = await GET(req(), { params: { id: 'camp1' } })
    const body = await response.json()
    expect(body).toEqual({ enabled: false, token: null })
  })

  it('returns the token while sharing is enabled', async () => {
    db.campaign.findUnique.mockResolvedValue({ chronicleShareEnabled: true, chronicleShareToken: 'live-token' })
    const response = await GET(req(), { params: { id: 'camp1' } })
    const body = await response.json()
    expect(body).toEqual({ enabled: true, token: 'live-token' })
  })
})

describe('POST', () => {
  it('rejects a non-admin', async () => {
    ;(getCampaignMembership as any).mockResolvedValue({ role: 'PLAYER' })
    const response = await POST(req(), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
    expect(db.campaign.update).not.toHaveBeenCalled()
  })

  it('mints a fresh token and enables sharing', async () => {
    db.campaign.update.mockResolvedValue({ chronicleShareToken: 'fresh-token' })
    const response = await POST(req(), { params: { id: 'camp1' } })
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body).toEqual({ enabled: true, token: 'fresh-token' })
    expect(db.campaign.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'camp1' },
      data: expect.objectContaining({ chronicleShareEnabled: true }),
    }))
  })
})

describe('DELETE', () => {
  it('rejects a non-admin', async () => {
    ;(getCampaignMembership as any).mockResolvedValue({ role: 'PLAYER' })
    const response = await DELETE(req(), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
    expect(db.campaign.update).not.toHaveBeenCalled()
  })

  it('disables sharing and clears the token, not just a flag flip', async () => {
    db.campaign.update.mockResolvedValue({})
    const response = await DELETE(req(), { params: { id: 'camp1' } })
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body).toEqual({ enabled: false, token: null })
    expect(db.campaign.update).toHaveBeenCalledWith({
      where: { id: 'camp1' },
      data: { chronicleShareEnabled: false, chronicleShareToken: null },
    })
  })
})
