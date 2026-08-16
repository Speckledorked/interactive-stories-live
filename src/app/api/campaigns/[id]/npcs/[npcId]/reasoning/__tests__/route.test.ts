// src/app/api/campaigns/[id]/npcs/[npcId]/reasoning/__tests__/route.test.ts
// #94 — read-only "why" preview for the NPC admin tab.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    nPC: { findFirst: vi.fn() },
    worldMeta: { findUnique: vi.fn() },
    location: { findMany: vi.fn() },
    locationAdjacency: { findMany: vi.fn() },
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
  return new NextRequest(`http://localhost/api/campaigns/camp1/npcs/npc1/reasoning${query}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getUser as any).mockResolvedValue({ userId: 'user1', email: 'user1@example.com' })
  ;(requireCampaignAdmin as any).mockResolvedValue({ membership: { role: 'ADMIN' } })
  db.location.findMany.mockResolvedValue([])
  db.locationAdjacency.findMany.mockResolvedValue([])
})

describe('GET /campaigns/[id]/npcs/[npcId]/reasoning', () => {
  it('rejects a non-admin', async () => {
    ;(requireCampaignAdmin as any).mockResolvedValue({ response: new Response(null, { status: 403 }) })
    const response = await GET(req(), { params: { id: 'camp1', npcId: 'npc1' } })
    expect(response.status).toBe(403)
    expect(db.nPC.findFirst).not.toHaveBeenCalled()
  })

  it('404s when the NPC does not exist in this campaign', async () => {
    db.nPC.findFirst.mockResolvedValue(null)
    db.worldMeta.findUnique.mockResolvedValue({ currentTurnNumber: 5 })

    const response = await GET(req(), { params: { id: 'camp1', npcId: 'npc1' } })
    expect(response.status).toBe(404)
  })

  it('404s when the campaign has no world state yet', async () => {
    db.nPC.findFirst.mockResolvedValue({ id: 'npc1', name: 'Elder Rowan', goals: 'g', relationship: null, currentLocation: null, goalProgress: 0, faction: null })
    db.worldMeta.findUnique.mockResolvedValue(null)

    const response = await GET(req(), { params: { id: 'camp1', npcId: 'npc1' } })
    expect(response.status).toBe(404)
  })

  it('returns the NPC\'s next-tick decision', async () => {
    db.nPC.findFirst.mockResolvedValue({
      id: 'npc1', name: 'Elder Rowan', goals: 'Broker peace', relationship: 'wary of the council',
      currentLocation: 'Ashcrown Hold', goalProgress: 40, faction: { name: 'Ashcrown', goal: 'CONSOLIDATE', isActive: true },
    })
    db.worldMeta.findUnique.mockResolvedValue({ currentTurnNumber: 5 })

    const response = await GET(req(), { params: { id: 'camp1', npcId: 'npc1' } })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.npc).toEqual({ id: 'npc1', name: 'Elder Rowan' })
    expect(body.decision).toMatchObject({ currentPlan: expect.stringContaining('Broker peace') })
    expect(typeof body.decision.phase).toBe('string')
  })

  it('passes real adjacency data through to the decision', async () => {
    db.nPC.findFirst.mockResolvedValue({
      id: 'npc1', name: 'Elder Rowan', goals: 'Broker peace', relationship: null,
      currentLocation: 'Home', goalProgress: 0, faction: null,
    })
    db.worldMeta.findUnique.mockResolvedValue({ currentTurnNumber: 5 })
    db.location.findMany.mockResolvedValue([
      { id: 'loc-home', name: 'Home' },
      { id: 'loc-work', name: 'Work' },
      { id: 'loc-far', name: 'Far Away' },
    ])
    db.locationAdjacency.findMany.mockResolvedValue([{ locationAId: 'loc-home', locationBId: 'loc-work', distance: 1 }])

    const response = await GET(req(), { params: { id: 'camp1', npcId: 'npc1' } })
    const body = await response.json()

    expect(response.status).toBe(200)
    // Whatever the phase/time-of-day pick, nextLocation must only ever be
    // one of the two real neighbors surfaced by the adjacency query — never
    // a third unrelated location the graph doesn't connect Home to.
    if (body.decision.nextLocation) {
      expect(['Home', 'Work']).toContain(body.decision.nextLocation)
    }
  })
})

describe('what-if overrides (#427)', () => {
  const NPC = {
    id: 'npc1', name: 'Elder Rowan', goals: 'Rebuild the shrine',
    relationship: null, currentLocation: null, goalProgress: 10, faction: null,
  }

  beforeEach(() => {
    db.nPC.findFirst.mockResolvedValue({ ...NPC })
    db.worldMeta.findUnique.mockResolvedValue({ currentTurnNumber: 5 })
    db.location.findMany.mockResolvedValue([])
    db.locationAdjacency.findMany.mockResolvedValue([])
  })

  it('writes nothing', async () => {
    await GET(req('?goalProgress=90'), { params: { id: 'camp1', npcId: 'npc1' } })

    for (const model of Object.values(db)) {
      for (const [name, fn] of Object.entries(model as Record<string, unknown>)) {
        if (/^(create|update|upsert|delete)/.test(name)) {
          expect(fn, `route called ${name} during a what-if`).not.toHaveBeenCalled()
        }
      }
    }
  })

  it('projects from an overridden goal progress', async () => {
    // goalProgress accumulates from the tick itself, so "is this NPC about
    // to finish?" previously needed the turn that answers it.
    const early = await (await GET(req('?goalProgress=0'), { params: { id: 'camp1', npcId: 'npc1' } })).json()
    const late = await (await GET(req('?goalProgress=95'), { params: { id: 'camp1', npcId: 'npc1' } })).json()

    expect(late.decision.newGoalProgress).toBeGreaterThan(early.decision.newGoalProgress)
    expect(late.whatIf.overridden).toEqual(['goalProgress'])
    expect(late.whatIf.actual.goalProgress).toBe(10)
  })

  it('is inert without params', async () => {
    const body = await (await GET(req(), { params: { id: 'camp1', npcId: 'npc1' } })).json()

    expect(body.whatIf.overridden).toEqual([])
  })
})
