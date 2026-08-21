// src/app/api/campaigns/[id]/capabilities/__tests__/route.test.ts
//
// The creation wizard's capability picker. The route's real risk is fog of
// war: secret and shadow branches must never reach the client at all — a
// node a player cannot start with must not appear in a list of things they
// cannot pick, because the refusal itself would leak that the branch exists
// (#94's rule: gate the response, don't strip fields).

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ getUser: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({ getCampaignMembership: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { campaignCapability: { findMany: vi.fn() } },
}))

import { getUser } from '@/lib/auth'
import { getCampaignMembership } from '@/lib/db/campaignAccess'
import { prisma } from '@/lib/prisma'
import { GET } from '../route'

const db = prisma as any

function request() {
  return new NextRequest('http://localhost/api/campaigns/camp1/capabilities')
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getUser as any).mockResolvedValue({ userId: 'player1' })
  ;(getCampaignMembership as any).mockResolvedValue({ role: 'PLAYER' })
})

describe('GET', () => {
  it('rejects an anonymous caller', async () => {
    ;(getUser as any).mockResolvedValue(null)
    const response = await GET(request(), { params: { id: 'camp1' } })
    expect(response.status).toBe(401)
  })

  it('rejects a non-member', async () => {
    ;(getCampaignMembership as any).mockResolvedValue(null)
    const response = await GET(request(), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
  })

  it('asks the database only for visible nodes — secrets never reach the response to be filtered', async () => {
    db.campaignCapability.findMany.mockResolvedValue([])
    await GET(request(), { params: { id: 'camp1' } })
    expect(db.campaignCapability.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ campaignId: 'camp1', isSecret: false, isShadow: false }),
      })
    )
  })

  it('ships the picker shape with prerequisite ids flattened', async () => {
    db.campaignCapability.findMany.mockResolvedValue([
      {
        id: 'battle-alchemy', key: 'battle-alchemy', name: 'Battle Alchemy',
        domain: 'Alchemy', tier: 2, description: 'Bombs mid-melee.',
        prerequisites: [{ prerequisiteCapabilityId: 'alchemy' }],
      },
    ])
    const body = await (await GET(request(), { params: { id: 'camp1' } })).json()
    expect(body.capabilities).toEqual([
      {
        id: 'battle-alchemy', key: 'battle-alchemy', name: 'Battle Alchemy',
        domain: 'Alchemy', tier: 2, description: 'Bombs mid-melee.',
        prerequisiteIds: ['alchemy'],
      },
    ])
  })
})
