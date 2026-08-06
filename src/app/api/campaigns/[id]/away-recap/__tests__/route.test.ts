// src/app/api/campaigns/[id]/away-recap/__tests__/route.test.ts
// #135 (cont.) — the away-recap checkpoint had no test coverage: the
// membership gate, skipping the event query on a first-ever visit (no
// previousLastViewedAt to compare against), and that it always stamps
// lastViewedAt regardless, were all unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ getUser: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({ getCampaignMembership: vi.fn() }))
vi.mock('@/lib/game/awayRecap', () => ({ buildAwayRecap: vi.fn(() => ({ summary: 'stub' })) }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    timelineEvent: { findMany: vi.fn() },
    campaignMembership: { update: vi.fn() },
  },
}))

import { getUser } from '@/lib/auth'
import { getCampaignMembership } from '@/lib/db/campaignAccess'
import { buildAwayRecap } from '@/lib/game/awayRecap'
import { prisma } from '@/lib/prisma'
import { GET } from '../route'

const db = prisma as any

function req() {
  return new NextRequest('http://localhost/api/campaigns/camp1/away-recap')
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getUser as any).mockResolvedValue({ userId: 'player1' })
  ;(getCampaignMembership as any).mockResolvedValue({ id: 'mem1', lastViewedAt: null })
  db.timelineEvent.findMany.mockResolvedValue([])
  db.campaignMembership.update.mockResolvedValue({})
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

  it('skips the event query on a first-ever visit', async () => {
    const response = await GET(req(), { params: { id: 'camp1' } })
    expect(response.status).toBe(200)
    expect(db.timelineEvent.findMany).not.toHaveBeenCalled()
    expect(buildAwayRecap).toHaveBeenCalledWith([], null, expect.any(Date))
  })

  it('queries offscreen public/mixed events since the last visit', async () => {
    const lastViewedAt = new Date('2026-01-01')
    ;(getCampaignMembership as any).mockResolvedValue({ id: 'mem1', lastViewedAt })
    await GET(req(), { params: { id: 'camp1' } })
    expect(db.timelineEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        campaignId: 'camp1',
        isOffscreen: true,
        visibility: { in: ['PUBLIC', 'MIXED'] },
        createdAt: { gt: lastViewedAt },
      },
    }))
  })

  it('always stamps lastViewedAt on the membership', async () => {
    await GET(req(), { params: { id: 'camp1' } })
    expect(db.campaignMembership.update).toHaveBeenCalledWith({
      where: { id: 'mem1' },
      data: { lastViewedAt: expect.any(Date) },
    })
  })

  it('returns 500 on an unexpected error', async () => {
    db.campaignMembership.update.mockRejectedValue(new Error('db down'))
    const response = await GET(req(), { params: { id: 'camp1' } })
    expect(response.status).toBe(500)
  })
})
