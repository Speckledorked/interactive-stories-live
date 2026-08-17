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
    worldEvent: {
      findMany: vi.fn(),
      // #445: the true absence window, measured with one aggregate rather
      // than inferred from the bounded scan. Defaults to "nothing beyond
      // the sample" so every existing assertion keeps its old meaning.
      aggregate: vi.fn(async () => ({ _count: { _all: 0 }, _min: { turnNumber: null }, _max: { turnNumber: null } })),
    },
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

  // #445: JOURNAL_SCAN_LIMIT bounds a SCAN, and turnRange/totalEvents used
  // to be derived from whatever survived it. The scan is ordered newest-first,
  // so a long absence's oldest events fall off the end — a thirty-day absence
  // was reported as roughly ten turns. The number shown to the player was
  // wrong, not merely capped, which is worse: a capped list reads as a
  // sample, a wrong range reads as a fact.
  //
  // The live-DB test for buildAbsenceJournal never caught it because it calls
  // the pure function on an unlimited query, so the truncation the route does
  // was never in the picture.
  it('reports the whole absence window, not just the scanned slice (#445)', async () => {
    const lastViewedAt = new Date('2026-01-01')
    ;(getCampaignMembership as any).mockResolvedValue({ id: 'mem1', lastViewedAt })
    ;(buildAwayRecap as any).mockReturnValue(null)
    // What the bounded scan returned: two recent turns.
    db.worldEvent.findMany.mockResolvedValue([
      {
        id: 'w1', turnNumber: 41, createdAt: new Date('2026-02-01'),
        targetType: 'CLOCK', targetId: 'k1', targetName: 'The Siege',
        field: 'currentTicks', significant: true, importance: 'MAJOR',
      },
      {
        id: 'w2', turnNumber: 40, createdAt: new Date('2026-01-31'),
        targetType: 'CLOCK', targetId: 'k1', targetName: 'The Siege',
        field: 'currentTicks', significant: false, importance: 'NORMAL',
      },
    ])
    // What actually happened: 900 events spanning turns 12 to 41.
    db.worldEvent.aggregate.mockResolvedValue({
      _count: { _all: 900 }, _min: { turnNumber: 12 }, _max: { turnNumber: 41 },
    })

    const response = await GET(req(), { params: { id: 'camp1' } })
    const body = await response.json()

    expect(body.journal.turnRange).toEqual({ from: 12, to: 41 })
    expect(body.journal.totalEvents).toBe(900)
    // And says out loud that the entries are a selection, so the UI can
    // render "showing N of M" rather than implying the absence was small.
    expect(body.journal.truncated).toBe(true)
  })

  it('fogs the window count the same way it fogs the entries (#445)', async () => {
    // A total that included undiscovered NPCs would leak their existence as
    // a number — the same per-TYPE fog rule the entry filter uses, applied
    // to the aggregate.
    const lastViewedAt = new Date('2026-01-01')
    ;(getCampaignMembership as any).mockResolvedValue({ id: 'mem1', lastViewedAt })
    ;(buildAwayRecap as any).mockReturnValue(null)
    db.faction.findMany.mockResolvedValue([{ id: 'known-faction' }])
    db.nPC.findMany.mockResolvedValue([])
    db.worldEvent.findMany.mockResolvedValue([])

    await GET(req(), { params: { id: 'camp1' } })

    const where = db.worldEvent.aggregate.mock.calls[0][0].where
    expect(where.OR).toEqual([
      { targetType: { notIn: expect.any(Array) } },
      { targetId: { in: ['known-faction'] } },
    ])
  })

  it('claims nothing beyond the sample when the aggregate fails (#445)', async () => {
    // A failed count must degrade to the sample-derived numbers, not take
    // the whole "while you were away" down with it. An approximate range is
    // worse than a real one and far better than no recap.
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
    db.worldEvent.aggregate.mockRejectedValueOnce(new Error('db down'))

    const response = await GET(req(), { params: { id: 'camp1' } })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.journal.turnRange).toEqual({ from: 7, to: 7 })
    expect(body.journal.truncated).toBe(false)
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
