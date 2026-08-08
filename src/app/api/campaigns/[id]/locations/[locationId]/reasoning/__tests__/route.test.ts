// src/app/api/campaigns/[id]/locations/[locationId]/reasoning/__tests__/route.test.ts
// #126 — read-only "why" preview for the Locations admin tab.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    location: { findFirst: vi.fn() },
    war: { findFirst: vi.fn() },
  },
}))
vi.mock('@/lib/auth', () => ({ getUser: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({ requireCampaignAdmin: vi.fn() }))

import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { requireCampaignAdmin } from '@/lib/db/campaignAccess'
import { GET } from '../route'

const db = prisma as any

function req() {
  return new NextRequest('http://localhost/api/campaigns/camp1/locations/loc1/reasoning')
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getUser as any).mockResolvedValue({ userId: 'user1', email: 'user1@example.com' })
  ;(requireCampaignAdmin as any).mockResolvedValue({ membership: { role: 'ADMIN' } })
})

describe('GET /campaigns/[id]/locations/[locationId]/reasoning', () => {
  it('rejects a non-admin', async () => {
    ;(requireCampaignAdmin as any).mockResolvedValue({ response: new Response(null, { status: 403 }) })
    const response = await GET(req(), { params: { id: 'camp1', locationId: 'loc1' } })
    expect(response.status).toBe(403)
    expect(db.location.findFirst).not.toHaveBeenCalled()
  })

  it('404s when the location does not exist in this campaign', async () => {
    db.location.findFirst.mockResolvedValue(null)
    const response = await GET(req(), { params: { id: 'camp1', locationId: 'loc1' } })
    expect(response.status).toBe(404)
    expect(db.war.findFirst).not.toHaveBeenCalled()
  })

  it('reports war damage when an ESCALATING war contests this location', async () => {
    db.location.findFirst.mockResolvedValue({ id: 'loc1', name: 'The Keep', conditionScore: 60, isContested: true })
    db.war.findFirst.mockResolvedValue({ id: 'war1' })

    const response = await GET(req(), { params: { id: 'camp1', locationId: 'loc1' } })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.location).toEqual({ id: 'loc1', name: 'The Keep' })
    expect(body.currentConditionScore).toBe(60)
    expect(body.projectedConditionScore).toBe(52)
    expect(body.reasoning.join(' ')).toMatch(/ongoing war/i)
    expect(db.war.findFirst).toHaveBeenCalledWith({
      where: { campaignId: 'camp1', status: 'ESCALATING', contestedLocationId: 'loc1' },
      select: { id: true },
    })
  })

  it('reports peacetime recovery when no war contests this location', async () => {
    db.location.findFirst.mockResolvedValue({ id: 'loc1', name: 'The Docks', conditionScore: 40, isContested: false })
    db.war.findFirst.mockResolvedValue(null)

    const response = await GET(req(), { params: { id: 'camp1', locationId: 'loc1' } })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.projectedConditionScore).toBe(41)
    expect(body.reasoning.join(' ')).toMatch(/recovering/i)
  })

  it('includes current and projected condition tags', async () => {
    db.location.findFirst.mockResolvedValue({ id: 'loc1', name: 'The Ruins', conditionScore: 20, isContested: false })
    db.war.findFirst.mockResolvedValue(null)

    const response = await GET(req(), { params: { id: 'camp1', locationId: 'loc1' } })
    const body = await response.json()

    expect(body.currentTags).toEqual(['RUINED'])
    expect(body.projectedTags).toEqual(['RUINED'])
  })
})
