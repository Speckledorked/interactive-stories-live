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

function req(query = '') {
  return new NextRequest(`http://localhost/api/campaigns/camp1/clocks/clock1/reasoning${query}`)
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

describe('what-if overrides (#427)', () => {
  const CLOCK = {
    id: 'clock1', name: 'The Siege', category: 'default', currentTicks: 2, maxTicks: 8,
    sourceFactionId: null, relatedFactionId: null, participantNpcIds: [],
  }

  beforeEach(() => {
    db.clock.findFirst.mockResolvedValue({ ...CLOCK })
  })

  it('writes nothing', async () => {
    await GET(req('?tension=95'), { params: { id: 'camp1', clockId: 'clock1' } })

    for (const model of Object.values(db)) {
      for (const [name, fn] of Object.entries(model as Record<string, unknown>)) {
        if (/^(create|update|upsert|delete)/.test(name)) {
          expect(fn, `route called ${name} during a what-if`).not.toHaveBeenCalled()
        }
      }
    }
  })

  it('projects from an overridden tension', async () => {
    // Tension is the only explainClockAdvancement input a GM cannot set
    // anywhere in the app — it is derived from live state. "Would this move
    // faster if the campaign were tenser?" was unanswerable before this.
    const calm = await (await GET(req('?tension=0'), { params: { id: 'camp1', clockId: 'clock1' } })).json()
    const dire = await (await GET(req('?tension=100'), { params: { id: 'camp1', clockId: 'clock1' } })).json()

    expect(dire.projectedAdvance).toBeGreaterThanOrEqual(calm.projectedAdvance)
    expect(dire.whatIf.overridden).toEqual(['tension'])
  })

  it('projects ticks from an overridden currentTicks', async () => {
    const body = await (await GET(req('?currentTicks=7'), { params: { id: 'camp1', clockId: 'clock1' } })).json()

    expect(body.clock.currentTicks).toBe(7)
    expect(body.whatIf.actual.currentTicks).toBe(2)
  })

  it('rejects an out-of-range override and keeps the real value', async () => {
    const body = await (await GET(req('?tension=500'), { params: { id: 'camp1', clockId: 'clock1' } })).json()

    expect(body.whatIf.overridden).toEqual([])
    expect(body.whatIf.rejected).toHaveLength(1)
  })
})
