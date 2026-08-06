// src/app/api/campaigns/[id]/members/__tests__/route.test.ts
// #135 (cont.) — the member list read had no test coverage: the
// membership gate, and that each member's character count is scoped to
// THIS campaign (not a global count across every campaign that user
// belongs to), were both unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({ getCampaignMembership: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaignMembership: { findMany: vi.fn() },
    character: { count: vi.fn() },
  },
}))

import { requireAuth } from '@/lib/auth'
import { getCampaignMembership } from '@/lib/db/campaignAccess'
import { prisma } from '@/lib/prisma'
import { GET } from '../route'

const db = prisma as any

function req() {
  return new NextRequest('http://localhost/api/campaigns/camp1/members')
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(requireAuth as any).mockResolvedValue({ userId: 'u1' })
  ;(getCampaignMembership as any).mockResolvedValue({ role: 'PLAYER' })
  db.campaignMembership.findMany.mockResolvedValue([])
  db.character.count.mockResolvedValue(0)
})

describe('GET', () => {
  it('rejects an unauthenticated request', async () => {
    ;(requireAuth as any).mockRejectedValue(new Error('Unauthorized'))
    const response = await GET(req(), { params: { id: 'camp1' } })
    expect(response.status).toBe(401)
  })

  it('rejects a non-member', async () => {
    ;(getCampaignMembership as any).mockResolvedValue(null)
    const response = await GET(req(), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
  })

  it('scopes each member\'s character count to this campaign', async () => {
    db.campaignMembership.findMany.mockResolvedValue([{ userId: 'u1', role: 'ADMIN' }])
    db.character.count.mockResolvedValue(2)
    const response = await GET(req(), { params: { id: 'camp1' } })
    const body = await response.json()
    expect(db.character.count).toHaveBeenCalledWith({ where: { userId: 'u1', campaignId: 'camp1' } })
    expect(body.members[0]._count.characters).toBe(2)
  })
})
