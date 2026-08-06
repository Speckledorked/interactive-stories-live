// src/app/api/campaigns/[id]/world-events/__tests__/route.test.ts
// #135 (cont.) — the admin-only tick-log browser had no test coverage:
// the admin gate, and the turn-number query param validation, were both
// unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ getUser: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({ requireCampaignAdmin: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { worldEvent: { findMany: vi.fn() } },
}))

import { getUser } from '@/lib/auth'
import { requireCampaignAdmin } from '@/lib/db/campaignAccess'
import { prisma } from '@/lib/prisma'
import { GET } from '../route'

const db = prisma as any

function req(query = '') {
  return new NextRequest(`http://localhost/api/campaigns/camp1/world-events${query}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getUser as any).mockResolvedValue({ userId: 'admin1' })
  ;(requireCampaignAdmin as any).mockResolvedValue({ membership: { role: 'ADMIN' } })
  db.worldEvent.findMany.mockResolvedValue([])
})

describe('GET', () => {
  it('rejects an unauthenticated request', async () => {
    ;(getUser as any).mockResolvedValue(null)
    const response = await GET(req(), { params: { id: 'camp1' } })
    expect(response.status).toBe(401)
  })

  it('rejects a non-admin', async () => {
    ;(requireCampaignAdmin as any).mockResolvedValue({ response: new Response(null, { status: 403 }) })
    const response = await GET(req(), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
    expect(db.worldEvent.findMany).not.toHaveBeenCalled()
  })

  it('rejects a non-integer turn filter', async () => {
    const response = await GET(req('?turn=not-a-number'), { params: { id: 'camp1' } })
    expect(response.status).toBe(400)
  })

  it('queries unfiltered when no turn is given', async () => {
    await GET(req(), { params: { id: 'camp1' } })
    expect(db.worldEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { campaignId: 'camp1' } }))
  })

  it('filters to the requested turn', async () => {
    await GET(req('?turn=5'), { params: { id: 'camp1' } })
    expect(db.worldEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { campaignId: 'camp1', turnNumber: 5 },
    }))
  })
})
