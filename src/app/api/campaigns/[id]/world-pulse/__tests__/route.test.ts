// src/app/api/campaigns/[id]/world-pulse/__tests__/route.test.ts
// #523 — the window is the whole decision, so that is what this pins:
// anchored to the scene rather than to lastViewedAt, empty without a
// scene, and shaped into rendered lines rather than raw journal entries.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ getUser: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({ getCampaignMembership: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    scene: { findFirst: vi.fn() },
    worldEvent: {
      findMany: vi.fn(),
      aggregate: vi.fn(async () => ({
        _count: { _all: 0 },
        _min: { turnNumber: null },
        _max: { turnNumber: null },
      })),
    },
    faction: { findMany: vi.fn() },
    nPC: { findMany: vi.fn() },
    location: { findMany: vi.fn() },
    clock: { findMany: vi.fn() },
  },
}))

import { getUser } from '@/lib/auth'
import { getCampaignMembership } from '@/lib/db/campaignAccess'
import { prisma } from '@/lib/prisma'
import { GET, MAX_PULSE_ENTRIES } from '../route'

const db = prisma as any
const params = { params: { id: 'camp1' } }
const SCENE_STARTED = new Date('2026-03-03T12:00:00Z')

function request() {
  return new NextRequest('http://localhost/api/campaigns/camp1/world-pulse')
}

function factionEvent(i: number) {
  return {
    id: `w${i}`,
    turnNumber: 20 + i,
    createdAt: new Date('2026-03-03T12:05:00Z'),
    targetType: 'FACTION',
    targetId: 'f1',
    targetName: 'The Iron Company',
    field: 'resources',
    significant: true,
    importance: 'MAJOR',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getUser as any).mockResolvedValue({ userId: 'player1' })
  ;(getCampaignMembership as any).mockResolvedValue({ role: 'PLAYER', lastViewedAt: new Date('2020-01-01') })
  db.scene.findFirst.mockResolvedValue({ id: 'scene1', createdAt: SCENE_STARTED })
  db.worldEvent.findMany.mockResolvedValue([factionEvent(1)])
  db.faction.findMany.mockResolvedValue([{ id: 'f1' }])
  db.nPC.findMany.mockResolvedValue([])
  db.location.findMany.mockResolvedValue([])
  db.clock.findMany.mockResolvedValue([])
})

describe('GET', () => {
  it('rejects an unauthenticated request', async () => {
    ;(getUser as any).mockResolvedValue(null)
    expect((await GET(request(), params)).status).toBe(401)
  })

  it('rejects a non-member', async () => {
    ;(getCampaignMembership as any).mockResolvedValue(null)
    expect((await GET(request(), params)).status).toBe(403)
  })

  it('windows on when the scene started, not on lastViewedAt', async () => {
    // The whole reason this route exists. A player sitting in a scene is
    // not viewing the lobby, so lastViewedAt is stale exactly when this
    // question is being asked.
    await GET(request(), params)
    expect(db.worldEvent.findMany.mock.calls[0][0].where.createdAt).toEqual({ gt: SCENE_STARTED })
  })

  it('says nothing when no scene is live', async () => {
    // Deliberately not a fallback to the absence window: that window
    // already has a surface, and answering one question in two voices is
    // what #396 warns against.
    db.scene.findFirst.mockResolvedValue(null)
    const body = await (await GET(request(), params)).json()
    expect(body).toEqual({ sceneId: null, entries: [], totalEvents: 0 })
    expect(db.worldEvent.findMany).not.toHaveBeenCalled()
  })

  it('looks only at scenes that are actually live', async () => {
    await GET(request(), params)
    expect(db.scene.findFirst.mock.calls[0][0].where.status).toEqual({
      in: ['AWAITING_ACTIONS', 'RESOLVING'],
    })
  })

  it('returns rendered lines, not raw journal entries', async () => {
    const body = await (await GET(request(), params)).json()
    expect(body.entries).toHaveLength(1)
    expect(body.entries[0].line).toBeTruthy()
    expect(body.entries[0].categoryLabel).toBe('Powers')
    // Raw fields would let a client render a targetId or a field name.
    expect(body.entries[0]).not.toHaveProperty('targetId')
    expect(body.entries[0]).not.toHaveProperty('field')
    expect(body.entries[0]).not.toHaveProperty('reason')
  })

  it('shows far fewer lines than the away letter', async () => {
    // A glance at the edge of a scene, not a reconstruction of an absence.
    db.worldEvent.findMany.mockResolvedValue(
      Array.from({ length: MAX_PULSE_ENTRIES + 6 }, (_, i) => factionEvent(i))
    )
    const body = await (await GET(request(), params)).json()
    expect(body.entries.length).toBeLessThanOrEqual(MAX_PULSE_ENTRIES)
  })

  it('still fogs what it reports', async () => {
    db.faction.findMany.mockResolvedValue([])
    const body = await (await GET(request(), params)).json()
    expect(body.entries).toEqual([])
  })
})
