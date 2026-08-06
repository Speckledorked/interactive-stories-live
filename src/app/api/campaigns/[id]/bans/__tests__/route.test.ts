// src/app/api/campaigns/[id]/bans/__tests__/route.test.ts
// #135 (cont.) — the GM-only ban list had no test coverage: the admin
// gate, and joining ban rows to user records (including the case where a
// banned user's account was since deleted), were both unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({ requireCampaignAdmin: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaignBan: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
  },
}))

import { requireAuth } from '@/lib/auth'
import { requireCampaignAdmin } from '@/lib/db/campaignAccess'
import { prisma } from '@/lib/prisma'
import { GET } from '../route'

const db = prisma as any

function req() {
  return new NextRequest('http://localhost/api/campaigns/camp1/bans')
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(requireAuth as any).mockResolvedValue({ userId: 'admin1' })
  ;(requireCampaignAdmin as any).mockResolvedValue({ membership: { role: 'ADMIN' } })
})

describe('GET', () => {
  it('rejects a non-admin', async () => {
    ;(requireCampaignAdmin as any).mockResolvedValue({ response: new Response(null, { status: 403 }) })
    const response = await GET(req(), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
    expect(db.campaignBan.findMany).not.toHaveBeenCalled()
  })

  it('returns an empty list without querying users when there are no bans', async () => {
    db.campaignBan.findMany.mockResolvedValue([])
    const response = await GET(req(), { params: { id: 'camp1' } })
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.bans).toEqual([])
    expect(db.user.findMany).not.toHaveBeenCalled()
  })

  it('joins each ban to its user record', async () => {
    db.campaignBan.findMany.mockResolvedValue([{ id: 'ban1', userId: 'u1', reason: 'griefing' }])
    db.user.findMany.mockResolvedValue([{ id: 'u1', name: 'Someone', email: 'someone@example.com' }])

    const response = await GET(req(), { params: { id: 'camp1' } })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.bans).toEqual([
      { id: 'ban1', userId: 'u1', reason: 'griefing', user: { id: 'u1', name: 'Someone', email: 'someone@example.com' } },
    ])
  })

  it('leaves user null for a ban whose account no longer exists', async () => {
    db.campaignBan.findMany.mockResolvedValue([{ id: 'ban1', userId: 'deleted-user' }])
    db.user.findMany.mockResolvedValue([])

    const response = await GET(req(), { params: { id: 'camp1' } })
    const body = await response.json()

    expect(body.bans[0].user).toBeNull()
  })

  it('returns 500 on an unexpected error', async () => {
    db.campaignBan.findMany.mockRejectedValue(new Error('db down'))
    const response = await GET(req(), { params: { id: 'camp1' } })
    expect(response.status).toBe(500)
  })
})
