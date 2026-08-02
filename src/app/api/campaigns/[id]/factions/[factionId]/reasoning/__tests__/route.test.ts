// src/app/api/campaigns/[id]/factions/[factionId]/reasoning/__tests__/route.test.ts
// #94 — read-only "why" preview for the faction admin tab.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    faction: { findFirst: vi.fn(), findUnique: vi.fn() },
    worldMeta: { findUnique: vi.fn() },
    worldEvent: { findFirst: vi.fn() },
    warParticipant: { findMany: vi.fn() },
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
  return new NextRequest('http://localhost/api/campaigns/camp1/factions/f1/reasoning')
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getUser as any).mockResolvedValue({ userId: 'user1', email: 'user1@example.com' })
  ;(requireCampaignAdmin as any).mockResolvedValue({ membership: { role: 'ADMIN' } })
})

describe('GET /campaigns/[id]/factions/[factionId]/reasoning', () => {
  it('rejects a non-admin', async () => {
    ;(requireCampaignAdmin as any).mockResolvedValue({ response: new Response(null, { status: 403 }) })
    const response = await GET(req(), { params: { id: 'camp1', factionId: 'f1' } })
    expect(response.status).toBe(403)
    expect(db.faction.findFirst).not.toHaveBeenCalled()
  })

  it('404s when the faction does not exist in this campaign', async () => {
    db.faction.findFirst.mockResolvedValue(null)
    db.worldMeta.findUnique.mockResolvedValue({ currentTurnNumber: 5 })

    const response = await GET(req(), { params: { id: 'camp1', factionId: 'f1' } })
    expect(response.status).toBe(404)
  })

  it('returns the goal reasoning for a faction with no rival and no wars', async () => {
    db.faction.findFirst.mockResolvedValue({
      id: 'f1', name: 'Ashcrown', goal: 'CONSOLIDATE', resources: 50, stability: 50, military: 50,
      relationships: {}, beliefVector: null, leaderCharacterId: null,
    })
    db.worldMeta.findUnique.mockResolvedValue({ currentTurnNumber: 5 })
    db.worldEvent.findFirst.mockResolvedValue(null)
    db.warParticipant.findMany.mockResolvedValue([])

    const response = await GET(req(), { params: { id: 'camp1', factionId: 'f1' } })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.faction).toEqual({ id: 'f1', name: 'Ashcrown', goal: 'CONSOLIDATE' })
    expect(body.goalReasoning.goal).toBe('CONSOLIDATE')
    expect(Array.isArray(body.goalReasoning.reasoning)).toBe(true)
    expect(body.wars).toEqual([])
  })

  it('gives a player-led faction a fixed explanation instead of running the automatic reassessment', async () => {
    db.faction.findFirst.mockResolvedValue({
      id: 'f1', name: 'Ashcrown', goal: 'EXPAND', resources: 90, stability: 90, military: 90,
      relationships: {}, beliefVector: null, leaderCharacterId: 'char1',
    })
    db.worldMeta.findUnique.mockResolvedValue({ currentTurnNumber: 5 })
    db.warParticipant.findMany.mockResolvedValue([])

    const response = await GET(req(), { params: { id: 'camp1', factionId: 'f1' } })
    const body = await response.json()

    expect(body.goalReasoning.goal).toBe('EXPAND')
    expect(body.goalReasoning.reasoning[0]).toMatch(/player character leads/i)
    expect(db.worldEvent.findFirst).not.toHaveBeenCalled()
  })

  it('ignores a rival that has since collapsed', async () => {
    db.faction.findFirst.mockResolvedValue({
      id: 'f1', name: 'Ashcrown', goal: 'CONSOLIDATE', resources: 80, stability: 50, military: 80,
      relationships: { f2: { type: 'RIVAL', since: 1 } }, beliefVector: null, leaderCharacterId: null,
    })
    db.worldMeta.findUnique.mockResolvedValue({ currentTurnNumber: 5 })
    db.worldEvent.findFirst.mockResolvedValue(null)
    db.faction.findUnique.mockResolvedValue({ isActive: false })
    db.warParticipant.findMany.mockResolvedValue([])

    const response = await GET(req(), { params: { id: 'camp1', factionId: 'f1' } })
    const body = await response.json()

    // High military + high resources with no ACTIVE rival -> EXPAND, not
    // DESTABILIZE_RIVAL, since the on-record rival no longer exists.
    expect(body.goalReasoning.goal).toBe('EXPAND')
  })

  it('includes momentum reasoning for a war this faction is fighting', async () => {
    db.faction.findFirst.mockResolvedValue({
      id: 'f1', name: 'Ashcrown', goal: 'CONSOLIDATE', resources: 50, stability: 50, military: 80,
      relationships: {}, beliefVector: null, leaderCharacterId: null,
    })
    db.worldMeta.findUnique.mockResolvedValue({ currentTurnNumber: 5 })
    db.worldEvent.findFirst.mockResolvedValue(null)
    db.warParticipant.findMany.mockResolvedValue([
      {
        side: 'ATTACKER',
        war: {
          id: 'war1', name: 'Siege of Ore Hills', momentum: 10, startedTurn: 1,
          attacker: { name: 'Ashcrown' }, defender: { name: 'Blackreach' },
          participants: [
            { side: 'ATTACKER', faction: { military: 80, isActive: true } },
            { side: 'DEFENDER', faction: { military: 20, isActive: true } },
          ],
        },
      },
    ])

    const response = await GET(req(), { params: { id: 'camp1', factionId: 'f1' } })
    const body = await response.json()

    expect(body.wars).toHaveLength(1)
    expect(body.wars[0]).toMatchObject({ warId: 'war1', name: 'Siege of Ore Hills', attackerName: 'Ashcrown', defenderName: 'Blackreach' })
    expect(Array.isArray(body.wars[0].reasoning)).toBe(true)
  })
})
