// src/app/api/campaigns/[id]/health/__tests__/route.test.ts
// #135 (cont.) — the campaign health read side had no test coverage: the
// Fix Log entry ("fetchData now calls this endpoint") only verified the
// admin panel calls it, never that the route itself behaves correctly —
// notably the "never assessed yet" case, which must read as neutral, not
// as a crisis.

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
  return new NextRequest('http://localhost/api/campaigns/camp1/health')
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

  it('reports not-yet-assessed as neutral, not a crisis, for a young campaign', async () => {
    db.worldMeta.findUnique.mockResolvedValue({
      currentHealthScore: null, lastHealthCheck: null, campaignHealthHistory: [], currentTurnNumber: 2,
    })
    const response = await GET(req(), { params: { id: 'camp1' } })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.assessed).toBe(false)
    expect(body.needsIntervention).toBe(false)
    expect(body.band).toBe('fair')
  })

  it('reports not-yet-assessed the same way when there is no WorldMeta row at all', async () => {
    db.worldMeta.findUnique.mockResolvedValue(null)
    const response = await GET(req(), { params: { id: 'camp1' } })
    const body = await response.json()
    expect(body.assessed).toBe(false)
    expect(body.currentTurnNumber).toBeNull()
  })

  it('surfaces the latest history entry\'s issues/recommendations alongside an assessed score', async () => {
    db.worldMeta.findUnique.mockResolvedValue({
      currentHealthScore: 72,
      lastHealthCheck: new Date('2026-08-01'),
      currentTurnNumber: 12,
      campaignHealthHistory: [
        { score: 80, issues: [], recommendations: [] },
        { score: 72, issues: ['pacing has stalled'], recommendations: ['advance a clock'] },
      ],
    })

    const response = await GET(req(), { params: { id: 'camp1' } })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.assessed).toBe(true)
    expect(body.score).toBe(72)
    expect(body.issues).toEqual(['pacing has stalled'])
    expect(body.recommendations).toEqual(['advance a clock'])
  })

  it('returns 500 on an unexpected error', async () => {
    db.worldMeta.findUnique.mockRejectedValue(new Error('db down'))
    const response = await GET(req(), { params: { id: 'camp1' } })
    expect(response.status).toBe(500)
  })
})
