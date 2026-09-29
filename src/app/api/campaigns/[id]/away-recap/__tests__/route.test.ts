// src/app/api/campaigns/[id]/away-recap/__tests__/route.test.ts
// #135 (cont.) — the away-recap checkpoint had no test coverage: the
// membership gate, skipping the event query on a first-ever visit (no
// previousLastViewedAt to compare against), and that it always stamps
// lastViewedAt regardless, were all unverified.
//
// #505 rewrote the contract these tests describe. GET no longer writes at
// all; it returns a `checkpoint` the client POSTs back once the recap has
// actually rendered. The tests that asserted "GET stamps lastViewedAt"
// have become tests that it does NOT, plus POST tests for the advance.

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
    campaignMembership: { update: vi.fn(), updateMany: vi.fn(async () => ({ count: 1 })) },
  },
}))

import { getUser } from '@/lib/auth'
import { getCampaignMembership } from '@/lib/db/campaignAccess'
import { buildAwayRecap } from '@/lib/game/awayRecap'
import { prisma } from '@/lib/prisma'
import { GET, POST } from '../route'

const db = prisma as any

function req() {
  return new NextRequest('http://localhost/api/campaigns/camp1/away-recap')
}

function ackReq(body: unknown) {
  return new NextRequest('http://localhost/api/campaigns/camp1/away-recap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
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

  it('writes nothing at all — GET is a safe method (#505)', async () => {
    // It used to advance lastViewedAt inline. The session cookie is
    // SameSite=Lax, which does not suppress top-level navigation, so a
    // plain link could make a signed-in visitor burn their own recap
    // window.
    await GET(req(), { params: { id: 'camp1' } })
    expect(db.campaignMembership.update).not.toHaveBeenCalled()
    expect(db.campaignMembership.updateMany).not.toHaveBeenCalled()
  })

  it('returns a checkpoint for the client to acknowledge when there is something to show', async () => {
    const response = await GET(req(), { params: { id: 'camp1' } })
    const body = await response.json()
    expect(typeof body.checkpoint).toBe('string')
    expect(Number.isNaN(Date.parse(body.checkpoint))).toBe(false)
  })

  it('returns a null checkpoint when there was nothing to show (#396)', async () => {
    // The checkpoint used to advance unconditionally, which starved the
    // feature it exists for: a player who opens the lobby every half hour
    // reset lastViewedAt on every visit, so `awayMs` never reached
    // MIN_AWAY_MS and no recap could ever be produced. A null checkpoint
    // is how that rule survives the read/write split — there is nothing
    // for the client to acknowledge.
    ;(buildAwayRecap as any).mockReturnValue(null)

    const response = await GET(req(), { params: { id: 'camp1' } })
    const body = await response.json()

    expect(body.checkpoint).toBeNull()
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
    // A journal with entries is something to show, so there is a
    // checkpoint to acknowledge even though the narrated recap was empty.
    expect(body.checkpoint).not.toBeNull()
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
    db.timelineEvent.findMany.mockRejectedValue(new Error('db down'))
    ;(getCampaignMembership as any).mockResolvedValue({ id: 'mem1', lastViewedAt: new Date('2026-01-01') })
    const response = await GET(req(), { params: { id: 'camp1' } })
    expect(response.status).toBe(500)
  })
})

describe('POST (acknowledge, #505)', () => {
  const params = { params: { id: 'camp1' } }

  it('rejects an unauthenticated request', async () => {
    ;(getUser as any).mockResolvedValue(null)
    const response = await POST(ackReq({ checkpoint: new Date().toISOString() }), params)
    expect(response.status).toBe(401)
    expect(db.campaignMembership.updateMany).not.toHaveBeenCalled()
  })

  it('rejects a non-member', async () => {
    ;(getCampaignMembership as any).mockResolvedValue(null)
    const response = await POST(ackReq({ checkpoint: new Date().toISOString() }), params)
    expect(response.status).toBe(403)
    expect(db.campaignMembership.updateMany).not.toHaveBeenCalled()
  })

  it('rejects a missing or unparseable checkpoint', async () => {
    expect((await POST(ackReq({}), params)).status).toBe(400)
    expect((await POST(ackReq({ checkpoint: 'not a date' }), params)).status).toBe(400)
    expect(db.campaignMembership.updateMany).not.toHaveBeenCalled()
  })

  it('rejects a checkpoint in the future', async () => {
    // A fast client clock, or a crafted value, must not be able to mark
    // events that have not happened yet as already seen.
    const future = new Date(Date.now() + 60_000).toISOString()
    const response = await POST(ackReq({ checkpoint: future }), params)
    expect(response.status).toBe(400)
    expect(db.campaignMembership.updateMany).not.toHaveBeenCalled()
  })

  it('advances the checkpoint, and only ever forwards', async () => {
    const checkpoint = new Date(Date.now() - 1000)
    const response = await POST(ackReq({ checkpoint: checkpoint.toISOString() }), params)

    expect(response.status).toBe(200)
    const call = db.campaignMembership.updateMany.mock.calls[0][0]
    expect(call.data).toEqual({ lastViewedAt: checkpoint })
    // The monotonic guard lives in the WHERE rather than a read-then-write,
    // so two lobby tabs acknowledging at once cannot interleave into the
    // older value winning.
    expect(call.where.OR).toEqual([
      { lastViewedAt: null },
      { lastViewedAt: { lt: checkpoint } },
    ])
  })

  it('reports a replayed acknowledgement as a no-op rather than an error', async () => {
    db.campaignMembership.updateMany.mockResolvedValue({ count: 0 })
    const response = await POST(ackReq({ checkpoint: new Date(Date.now() - 1000).toISOString() }), params)
    expect(response.status).toBe(200)
    expect((await response.json()).acknowledged).toBe(false)
  })
})
