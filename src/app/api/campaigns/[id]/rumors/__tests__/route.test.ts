// src/app/api/campaigns/[id]/rumors/__tests__/route.test.ts
// #135 (cont.) — the rumors feed had no test coverage: that it only ever
// surfaces summaryPublic (never summaryGM, which must stay GM-only
// regardless of role) was unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ getUser: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({ getCampaignMembership: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { timelineEvent: { findMany: vi.fn() } },
}))

import { getUser } from '@/lib/auth'
import { getCampaignMembership } from '@/lib/db/campaignAccess'
import { prisma } from '@/lib/prisma'
import { GET } from '../route'

const db = prisma as any

function req() {
  return new NextRequest('http://localhost/api/campaigns/camp1/rumors')
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

  it('only queries offscreen, public/mixed events with a public summary', async () => {
    db.timelineEvent.findMany.mockResolvedValue([])
    await GET(req(), { params: { id: 'camp1' } })
    expect(db.timelineEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { campaignId: 'camp1', isOffscreen: true, visibility: { in: ['PUBLIC', 'MIXED'] }, summaryPublic: { not: null } },
    }))
  })

  it('maps to rumors, never exposing summaryGM even if it were selected', async () => {
    db.timelineEvent.findMany.mockResolvedValue([
      { id: 'e1', turnNumber: 3, title: 'A war begins', summaryPublic: 'Word spreads of conflict.' },
    ])
    const response = await GET(req(), { params: { id: 'camp1' } })
    const body = await response.json()
    expect(body.rumors).toEqual([{ id: 'e1', turnNumber: 3, title: 'A war begins', summary: 'Word spreads of conflict.' }])
    expect(JSON.stringify(body)).not.toContain('summaryGM')
  })
})
