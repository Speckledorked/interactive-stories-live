// src/app/api/campaigns/[id]/integrity/__tests__/route.test.ts
// #135 (cont.) — the Integrity Engine read side had no test coverage: the
// membership gate, and that a brand-new campaign (no world turn has run an
// integrity pass yet) reads as "not yet assessed" rather than an error,
// were both unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ getUser: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({ getCampaignMembership: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { worldMeta: { findUnique: vi.fn() } },
}))

import { getUser } from '@/lib/auth'
import { getCampaignMembership } from '@/lib/db/campaignAccess'
import { prisma } from '@/lib/prisma'
import { GET } from '../route'

const db = prisma as any

function req() {
  return new NextRequest('http://localhost/api/campaigns/camp1/integrity')
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getUser as any).mockResolvedValue({ userId: 'player1' })
  ;(getCampaignMembership as any).mockResolvedValue({ role: 'PLAYER' })
})

describe('GET', () => {
  it('rejects an unauthenticated request', async () => {
    ;(getUser as any).mockResolvedValue(null)
    const response = await GET(req(), { params: { id: 'camp1' } })
    expect(response.status).toBe(401)
  })

  it('rejects a non-member', async () => {
    ;(getCampaignMembership as any).mockResolvedValue(null)
    const response = await GET(req(), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
  })

  it('reads as not-yet-assessed when no world turn has run a pass', async () => {
    db.worldMeta.findUnique.mockResolvedValue({ integrityReportHistory: [], lastIntegrityCheck: null })
    const response = await GET(req(), { params: { id: 'camp1' } })
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body).toEqual({ assessed: false, lastCheckedAt: null, latest: null, history: [] })
  })

  it('reads as not-yet-assessed when there is no WorldMeta row at all', async () => {
    db.worldMeta.findUnique.mockResolvedValue(null)
    const response = await GET(req(), { params: { id: 'camp1' } })
    const body = await response.json()
    expect(body.assessed).toBe(false)
  })

  it('returns the latest report and full history once assessed', async () => {
    const checkedAt = new Date('2026-01-01')
    db.worldMeta.findUnique.mockResolvedValue({
      lastIntegrityCheck: checkedAt,
      integrityReportHistory: [{ turnNumber: 1, issues: [] }, { turnNumber: 2, issues: ['x'] }],
    })
    const response = await GET(req(), { params: { id: 'camp1' } })
    const body = await response.json()
    expect(body.assessed).toBe(true)
    expect(body.latest).toEqual({ turnNumber: 2, issues: ['x'] })
    expect(body.history).toHaveLength(2)
  })

  it('returns 500 on an unexpected error', async () => {
    db.worldMeta.findUnique.mockRejectedValue(new Error('db down'))
    const response = await GET(req(), { params: { id: 'camp1' } })
    expect(response.status).toBe(500)
  })
})
