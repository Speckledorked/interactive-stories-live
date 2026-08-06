// src/app/api/campaigns/[id]/quests/__tests__/route.test.ts
// #135 (cont.) — the member-facing quest log had no test coverage: this
// route was called out as a deliberate fix (getUser() instead of hand-
// rolled token parsing that bypassed session revocation), which itself
// had never been verified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ getUser: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({ getCampaignMembership: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { quest: { findMany: vi.fn() } },
}))

import { getUser } from '@/lib/auth'
import { getCampaignMembership } from '@/lib/db/campaignAccess'
import { prisma } from '@/lib/prisma'
import { GET } from '../route'

const db = prisma as any

function req() {
  return new NextRequest('http://localhost/api/campaigns/camp1/quests')
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
    expect(db.quest.findMany).not.toHaveBeenCalled()
  })

  it('returns the campaign\'s quests, most recently updated first', async () => {
    db.quest.findMany.mockResolvedValue([{ id: 'q1', name: 'Find the Amulet' }])
    const response = await GET(req(), { params: { id: 'camp1' } })
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.quests).toEqual([{ id: 'q1', name: 'Find the Amulet' }])
    expect(db.quest.findMany).toHaveBeenCalledWith({ where: { campaignId: 'camp1' }, orderBy: { updatedAt: 'desc' } })
  })

  it('returns 500 on an unexpected error', async () => {
    db.quest.findMany.mockRejectedValue(new Error('db down'))
    const response = await GET(req(), { params: { id: 'camp1' } })
    expect(response.status).toBe(500)
  })
})
