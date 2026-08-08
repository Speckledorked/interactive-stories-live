// src/app/api/campaigns/[id]/clocks/[clockId]/reasoning/__tests__/route.test.ts
// #126 — read-only "why" preview for the Clocks admin tab.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    clock: { findFirst: vi.fn() },
    worldMeta: { findUnique: vi.fn() },
    faction: { findMany: vi.fn() },
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
  return new NextRequest('http://localhost/api/campaigns/camp1/clocks/clock1/reasoning')
}

function baseClock(overrides: Record<string, unknown> = {}) {
  return {
    id: 'clock1', name: 'The Reckoning', category: null, currentTicks: 1, maxTicks: 4,
    sourceFactionId: null, relatedFactionId: null, participantNpcIds: [],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getUser as any).mockResolvedValue({ userId: 'user1', email: 'user1@example.com' })
  ;(requireCampaignAdmin as any).mockResolvedValue({ membership: { role: 'ADMIN' } })
  db.worldMeta.findUnique.mockResolvedValue({
    currentTurnNumber: 5, tension: 25, totalElapsedGameHours: 0, campaign: { calendarConfig: null },
  })
  db.faction.findMany.mockResolvedValue([])
})

describe('GET /campaigns/[id]/clocks/[clockId]/reasoning', () => {
  it('rejects a non-admin', async () => {
    ;(requireCampaignAdmin as any).mockResolvedValue({ response: new Response(null, { status: 403 }) })
    const response = await GET(req(), { params: { id: 'camp1', clockId: 'clock1' } })
    expect(response.status).toBe(403)
    expect(db.clock.findFirst).not.toHaveBeenCalled()
  })

  it('404s when the clock does not exist in this campaign', async () => {
    db.clock.findFirst.mockResolvedValue(null)
    const response = await GET(req(), { params: { id: 'camp1', clockId: 'clock1' } })
    expect(response.status).toBe(404)
  })

  it('404s when the campaign has no world state yet', async () => {
    db.clock.findFirst.mockResolvedValue(baseClock())
    db.worldMeta.findUnique.mockResolvedValue(null)
    const response = await GET(req(), { params: { id: 'camp1', clockId: 'clock1' } })
    expect(response.status).toBe(404)
  })

  it('explains an urgent unattached clock always advancing', async () => {
    db.clock.findFirst.mockResolvedValue(baseClock({ category: 'urgent' }))

    const response = await GET(req(), { params: { id: 'camp1', clockId: 'clock1' } })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.clock).toEqual({ id: 'clock1', name: 'The Reckoning', currentTicks: 1, maxTicks: 4 })
    expect(body.projectedAdvance).toBe(1)
    expect(body.projectedTicks).toBe(2)
    expect(body.reasoning.join(' ')).toMatch(/urgent/i)
  })

  it('loads the real linked faction for a source-ambition clock', async () => {
    db.clock.findFirst.mockResolvedValue(baseClock({ sourceFactionId: 'f1' }))
    db.faction.findMany.mockResolvedValue([{ id: 'f1', resources: 80, military: 80, stability: 80, isActive: true }])

    const response = await GET(req(), { params: { id: 'camp1', clockId: 'clock1' } })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.projectedAdvance).toBe(2)
    expect(body.reasoning.join(' ')).toMatch(/HIGH/)
    expect(db.faction.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['f1'] } },
      select: { id: true, resources: true, military: true, stability: true, isActive: true },
    })
  })

  it('caps projectedTicks at maxTicks', async () => {
    db.clock.findFirst.mockResolvedValue(baseClock({ category: 'urgent', currentTicks: 4, maxTicks: 4 }))

    const response = await GET(req(), { params: { id: 'camp1', clockId: 'clock1' } })
    const body = await response.json()

    expect(body.projectedTicks).toBe(4)
  })

  it('does not query factions at all for an unlinked clock', async () => {
    db.clock.findFirst.mockResolvedValue(baseClock())

    await GET(req(), { params: { id: 'camp1', clockId: 'clock1' } })

    expect(db.faction.findMany).not.toHaveBeenCalled()
  })
})
