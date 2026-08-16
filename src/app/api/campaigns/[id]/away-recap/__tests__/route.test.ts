// src/app/api/campaigns/[id]/away-recap/__tests__/route.test.ts
// #135 (cont.) — the away-recap checkpoint had no test coverage: the
// membership gate, skipping the event query on a first-ever visit (no
// previousLastViewedAt to compare against), and that it always stamps
// lastViewedAt regardless, were all unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ getUser: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({ getCampaignMembership: vi.fn() }))
vi.mock('@/lib/game/awayRecap', () => ({ buildAwayRecap: vi.fn(() => ({ summary: 'stub' })) }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    timelineEvent: { findMany: vi.fn() },
    worldEvent: { findMany: vi.fn() },
    faction: { findMany: vi.fn() },
    nPC: { findMany: vi.fn() },
    campaignMembership: { update: vi.fn() },
  },
}))

import { getUser } from '@/lib/auth'
import { getCampaignMembership } from '@/lib/db/campaignAccess'
import { buildAwayRecap } from '@/lib/game/awayRecap'
import { prisma } from '@/lib/prisma'
import { GET } from '../route'

const db = prisma as any

function req() {
  return new NextRequest('http://localhost/api/campaigns/camp1/away-recap')
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getUser as any).mockResolvedValue({ userId: 'player1' })
  ;(getCampaignMembership as any).mockResolvedValue({ id: 'mem1', lastViewedAt: null })
  // mockReturnValue survives clearAllMocks, so restore the default stub
  // explicitly rather than letting one case's override leak into the next.
  ;(buildAwayRecap as any).mockReturnValue({ summary: 'stub' })
  db.timelineEvent.findMany.mockResolvedValue([])
  db.worldEvent.findMany.mockResolvedValue([])
  db.faction.findMany.mockResolvedValue([])
  db.nPC.findMany.mockResolvedValue([])
  db.campaignMembership.update.mockResolvedValue({})
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
  })

  it('skips the event query on a first-ever visit', async () => {
    const response = await GET(req(), { params: { id: 'camp1' } })
    expect(response.status).toBe(200)
    expect(db.timelineEvent.findMany).not.toHaveBeenCalled()
    expect(buildAwayRecap).toHaveBeenCalledWith([], null, expect.any(Date))
  })

  it('queries offscreen public/mixed events since the last visit', async () => {
    const lastViewedAt = new Date('2026-01-01')
    ;(getCampaignMembership as any).mockResolvedValue({ id: 'mem1', lastViewedAt })
    await GET(req(), { params: { id: 'camp1' } })
    expect(db.timelineEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        campaignId: 'camp1',
        isOffscreen: true,
        visibility: { in: ['PUBLIC', 'MIXED'] },
        createdAt: { gt: lastViewedAt },
      },
    }))
  })

  it('stamps lastViewedAt when the player was actually shown a recap', async () => {
    await GET(req(), { params: { id: 'camp1' } })
    expect(db.campaignMembership.update).toHaveBeenCalledWith({
      where: { id: 'mem1' },
      data: { lastViewedAt: expect.any(Date) },
    })
  })

  it('does NOT stamp lastViewedAt when there was nothing to show (#396)', async () => {
    // The checkpoint used to advance unconditionally, which starved the
    // feature it exists for: a player who opens the lobby every half hour
    // reset lastViewedAt on every visit, so `awayMs` never reached
    // MIN_AWAY_MS and no recap could ever be produced. It also meant a
    // response lost in flight burned the window for good.
    ;(buildAwayRecap as any).mockReturnValue(null)

    await GET(req(), { params: { id: 'camp1' } })

    expect(db.campaignMembership.update).not.toHaveBeenCalled()
  })

  it('reconstructs the absence from WorldEvent, not just the narrated feed (#396)', async () => {
    const lastViewedAt = new Date('2026-01-01')
    ;(getCampaignMembership as any).mockResolvedValue({ id: 'mem1', lastViewedAt })
    ;(buildAwayRecap as any).mockReturnValue(null)
    db.worldEvent.findMany.mockResolvedValue([
      {
        id: 'w1', turnNumber: 7, createdAt: new Date('2026-01-02'),
        targetType: 'CLOCK', targetId: 'k1', targetName: 'The Siege',
        field: 'currentTicks', significant: true, importance: 'MAJOR',
      },
    ])

    const response = await GET(req(), { params: { id: 'camp1' } })
    const body = await response.json()

    // A clock change — structurally unreachable from every player surface
    // before this, because they all read TimelineEvent.
    expect(body.journal.entries).toHaveLength(1)
    expect(body.journal.entries[0].category).toBe('clocks')
    expect(body.journal.entries[0].line).toContain('The Siege')
    // A journal with entries is something to show, so the checkpoint moves.
    expect(db.campaignMembership.update).toHaveBeenCalled()
  })

  it('hides events about undiscovered factions and NPCs (#396)', async () => {
    const lastViewedAt = new Date('2026-01-01')
    ;(getCampaignMembership as any).mockResolvedValue({ id: 'mem1', lastViewedAt })
    ;(buildAwayRecap as any).mockReturnValue(null)
    db.worldEvent.findMany.mockResolvedValue([
      {
        id: 'w1', turnNumber: 7, createdAt: new Date('2026-01-02'),
        targetType: 'FACTION', targetId: 'secret-faction', targetName: 'The Hollow Choir',
        field: 'collapsed', significant: true, importance: 'MAJOR',
      },
    ])
    // Nothing discovered.
    db.faction.findMany.mockResolvedValue([])

    const response = await GET(req(), { params: { id: 'camp1' } })
    const body = await response.json()

    expect(body.journal.entries).toEqual([])
  })

  it('returns 500 on an unexpected error', async () => {
    db.campaignMembership.update.mockRejectedValue(new Error('db down'))
    const response = await GET(req(), { params: { id: 'camp1' } })
    expect(response.status).toBe(500)
  })
})
