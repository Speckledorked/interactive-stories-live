// src/app/api/campaigns/[id]/invites/__tests__/route.test.ts
// #135 (cont.) — creating and listing campaign invites had no test
// coverage: the admin gate, the default expiry/max-uses, and GET's
// derived isExpired/isExhausted flags were all unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ getUser: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({ requireCampaignAdmin: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaignInvite: { create: vi.fn(), findMany: vi.fn() },
  },
}))

import { getUser } from '@/lib/auth'
import { requireCampaignAdmin } from '@/lib/db/campaignAccess'
import { prisma } from '@/lib/prisma'
import { POST, GET } from '../route'

const db = prisma as any

function postRequest(body: unknown) {
  return new NextRequest('http://localhost/api/campaigns/camp1/invites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function getRequest() {
  return new NextRequest('http://localhost/api/campaigns/camp1/invites')
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getUser as any).mockResolvedValue({ userId: 'admin1' })
  ;(requireCampaignAdmin as any).mockResolvedValue({ membership: { role: 'ADMIN' } })
})

describe('POST', () => {
  it('rejects an unauthenticated request', async () => {
    ;(getUser as any).mockResolvedValue(null)
    const response = await POST(postRequest({}), { params: { id: 'camp1' } })
    expect(response.status).toBe(401)
    expect(db.campaignInvite.create).not.toHaveBeenCalled()
  })

  it('rejects a non-admin', async () => {
    ;(requireCampaignAdmin as any).mockResolvedValue({ response: new Response(null, { status: 403 }) })
    const response = await POST(postRequest({}), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
    expect(db.campaignInvite.create).not.toHaveBeenCalled()
  })

  it('creates an invite with a 7-day/10-use default when none is given', async () => {
    db.campaignInvite.create.mockResolvedValue({ id: 'inv1', token: 'tok123' })
    const response = await POST(postRequest({}), { params: { id: 'camp1' } })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.joinUrl).toContain('/join/tok123')
    expect(db.campaignInvite.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        campaignId: 'camp1',
        createdBy: 'admin1',
        expiresAt: expect.any(Date),
        maxUses: 10,
      }),
    })
  })

  it('honors an explicit expiresAt/maxUses', async () => {
    db.campaignInvite.create.mockResolvedValue({ id: 'inv1', token: 'tok123' })
    const explicitExpiry = new Date(Date.now() + 1000).toISOString()

    await POST(postRequest({ expiresAt: explicitExpiry, maxUses: 1 }), { params: { id: 'camp1' } })

    expect(db.campaignInvite.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ expiresAt: new Date(explicitExpiry), maxUses: 1 }),
    })
  })
})

describe('GET', () => {
  it('rejects a non-admin', async () => {
    ;(requireCampaignAdmin as any).mockResolvedValue({ response: new Response(null, { status: 403 }) })
    const response = await GET(getRequest(), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
    expect(db.campaignInvite.findMany).not.toHaveBeenCalled()
  })

  it('marks an expired invite as expired', async () => {
    db.campaignInvite.findMany.mockResolvedValue([
      { id: 'inv1', token: 'tok1', expiresAt: new Date(Date.now() - 1000), maxUses: 10, uses: 1, createdByUser: { email: 'a@b.com' } },
    ])
    const response = await GET(getRequest(), { params: { id: 'camp1' } })
    const body = await response.json()
    expect(body.invites[0].isExpired).toBe(true)
    expect(body.invites[0].isExhausted).toBe(false)
  })

  it('marks an invite at its use limit as exhausted', async () => {
    db.campaignInvite.findMany.mockResolvedValue([
      { id: 'inv1', token: 'tok1', expiresAt: new Date(Date.now() + 60_000), maxUses: 5, uses: 5, createdByUser: { email: 'a@b.com' } },
    ])
    const response = await GET(getRequest(), { params: { id: 'camp1' } })
    const body = await response.json()
    expect(body.invites[0].isExpired).toBe(false)
    expect(body.invites[0].isExhausted).toBe(true)
  })

  it('treats maxUses 0 as unlimited, never exhausted', async () => {
    db.campaignInvite.findMany.mockResolvedValue([
      { id: 'inv1', token: 'tok1', expiresAt: new Date(Date.now() + 60_000), maxUses: 0, uses: 999, createdByUser: { email: 'a@b.com' } },
    ])
    const response = await GET(getRequest(), { params: { id: 'camp1' } })
    const body = await response.json()
    expect(body.invites[0].isExhausted).toBe(false)
  })
})
