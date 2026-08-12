// src/app/api/campaigns/[id]/wars/reasoning/__tests__/route.test.ts
// #126 — read-only, campaign-wide "why" preview for the admin Wars tab.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    worldMeta: { findUnique: vi.fn() },
    war: { findMany: vi.fn() },
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
  return new NextRequest('http://localhost/api/campaigns/camp1/wars/reasoning')
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getUser as any).mockResolvedValue({ userId: 'user1', email: 'user1@example.com' })
  ;(requireCampaignAdmin as any).mockResolvedValue({ membership: { role: 'ADMIN' } })
  db.worldMeta.findUnique.mockResolvedValue({ currentTurnNumber: 10 })
})

describe('GET /campaigns/[id]/wars/reasoning', () => {
  it('rejects a non-admin', async () => {
    ;(requireCampaignAdmin as any).mockResolvedValue({ response: new Response(null, { status: 403 }) })
    const response = await GET(req(), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
    expect(db.war.findMany).not.toHaveBeenCalled()
  })

  it('404s when the campaign has no world state yet', async () => {
    db.worldMeta.findUnique.mockResolvedValue(null)
    const response = await GET(req(), { params: { id: 'camp1' } })
    expect(response.status).toBe(404)
  })

  it('returns an empty list when no wars are escalating', async () => {
    db.war.findMany.mockResolvedValue([])
    const response = await GET(req(), { params: { id: 'camp1' } })
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.wars).toEqual([])
  })

  it('only queries ESCALATING wars, scoped to the campaign', async () => {
    db.war.findMany.mockResolvedValue([])
    await GET(req(), { params: { id: 'camp1' } })
    expect(db.war.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { campaignId: 'camp1', status: 'ESCALATING' },
    }))
  })

  it('bounds the query with a take cap (#224) rather than fetching every escalating war unbounded', async () => {
    db.war.findMany.mockResolvedValue([])
    await GET(req(), { params: { id: 'camp1' } })
    expect(db.war.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }))
  })

  it('computes momentum reasoning for each war from real participant military totals', async () => {
    db.war.findMany.mockResolvedValue([
      {
        id: 'war1', name: 'The Border Dispute', momentum: 10, startedTurn: 5,
        attacker: { name: 'Ironveil Guild' }, defender: { name: 'Free Merchants' },
        participants: [
          { side: 'ATTACKER', faction: { military: 60, isActive: true } },
          { side: 'DEFENDER', faction: { military: 40, isActive: true } },
        ],
      },
    ])

    const response = await GET(req(), { params: { id: 'camp1' } })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.wars).toHaveLength(1)
    expect(body.wars[0]).toMatchObject({
      warId: 'war1', name: 'The Border Dispute',
      attackerName: 'Ironveil Guild', defenderName: 'Free Merchants',
      attackerMilitaryTotal: 60, defenderMilitaryTotal: 40,
      currentMomentum: 10,
    })
    expect(Array.isArray(body.wars[0].reasoning)).toBe(true)
    expect(body.wars[0].reasoning.length).toBeGreaterThan(0)
  })

  it('excludes inactive/collapsed participants from military totals', async () => {
    db.war.findMany.mockResolvedValue([
      {
        id: 'war1', name: 'The Siege', momentum: 0, startedTurn: 1,
        attacker: { name: 'A' }, defender: { name: 'B' },
        participants: [
          { side: 'ATTACKER', faction: { military: 50, isActive: true } },
          { side: 'ATTACKER', faction: { military: 999, isActive: false } },
          { side: 'DEFENDER', faction: { military: 30, isActive: true } },
        ],
      },
    ])

    const response = await GET(req(), { params: { id: 'camp1' } })
    const body = await response.json()

    expect(body.wars[0].attackerMilitaryTotal).toBe(50)
    expect(body.wars[0].defenderMilitaryTotal).toBe(30)
  })

  it('returns multiple wars in the order the query returns them', async () => {
    db.war.findMany.mockResolvedValue([
      {
        id: 'war1', name: 'War One', momentum: 0, startedTurn: 1,
        attacker: { name: 'A' }, defender: { name: 'B' }, participants: [],
      },
      {
        id: 'war2', name: 'War Two', momentum: 0, startedTurn: 3,
        attacker: { name: 'C' }, defender: { name: 'D' }, participants: [],
      },
    ])

    const response = await GET(req(), { params: { id: 'camp1' } })
    const body = await response.json()

    expect(body.wars.map((w: any) => w.warId)).toEqual(['war1', 'war2'])
  })
})
