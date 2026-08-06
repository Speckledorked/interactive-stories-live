// src/app/api/campaigns/[id]/scenes/__tests__/route.test.ts
// #135 (cont.) — the scene list read had no test coverage: the auth gate
// (called out in the route's own comment as a previously missing
// special-case, same as tutorial/trigger/route.ts) and the membership
// gate were both unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({ getCampaignMembership: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { scene: { findMany: vi.fn() } },
}))

import { requireAuth } from '@/lib/auth'
import { getCampaignMembership } from '@/lib/db/campaignAccess'
import { prisma } from '@/lib/prisma'
import { GET } from '../route'

const db = prisma as any

function req() {
  return new NextRequest('http://localhost/api/campaigns/camp1/scenes')
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(requireAuth as any).mockResolvedValue({ userId: 'u1' })
  ;(getCampaignMembership as any).mockResolvedValue({ role: 'PLAYER' })
  db.scene.findMany.mockResolvedValue([])
})

describe('GET', () => {
  it('rejects an unauthenticated request with 401, not a bare 500', async () => {
    ;(requireAuth as any).mockRejectedValue(new Error('Unauthorized'))
    const response = await GET(req(), { params: { id: 'camp1' } })
    expect(response.status).toBe(401)
  })

  it('rejects a non-member', async () => {
    ;(getCampaignMembership as any).mockResolvedValue(null)
    const response = await GET(req(), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
  })

  it('returns the campaign scenes newest-first', async () => {
    db.scene.findMany.mockResolvedValue([{ id: 's1', sceneNumber: 3 }])
    const response = await GET(req(), { params: { id: 'camp1' } })
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.scenes).toEqual([{ id: 's1', sceneNumber: 3 }])
    expect(db.scene.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { campaignId: 'camp1' },
      orderBy: { sceneNumber: 'desc' },
    }))
  })
})
