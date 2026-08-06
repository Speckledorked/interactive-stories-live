// src/app/api/campaigns/[id]/archetypes/__tests__/route.test.ts
// #135 (cont.) — the character-creation archetype list had no test
// coverage: the membership gate was unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ getUser: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({ getCampaignMembership: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { campaignArchetype: { findMany: vi.fn() } },
}))

import { getUser } from '@/lib/auth'
import { getCampaignMembership } from '@/lib/db/campaignAccess'
import { prisma } from '@/lib/prisma'
import { GET } from '../route'

const db = prisma as any

function req() {
  return new NextRequest('http://localhost/api/campaigns/camp1/archetypes')
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
    expect(db.campaignArchetype.findMany).not.toHaveBeenCalled()
  })

  it('returns the campaign\'s archetypes', async () => {
    db.campaignArchetype.findMany.mockResolvedValue([{ id: 'a1', name: 'The Outsider' }])
    const response = await GET(req(), { params: { id: 'camp1' } })
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.archetypes).toEqual([{ id: 'a1', name: 'The Outsider' }])
  })

  it('returns 500 on an unexpected error', async () => {
    db.campaignArchetype.findMany.mockRejectedValue(new Error('db down'))
    const response = await GET(req(), { params: { id: 'camp1' } })
    expect(response.status).toBe(500)
  })
})
