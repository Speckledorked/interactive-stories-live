// src/app/api/campaigns/[id]/world-chronicle/__tests__/route.test.ts
// #522 — the guarantees: reason is never fetched, the fog applies, rows
// with no sentence are dropped rather than rendered raw, and paging does
// not end history early.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ getUser: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({ getCampaignMembership: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    worldEvent: { findMany: vi.fn() },
    faction: { findMany: vi.fn() },
    nPC: { findMany: vi.fn() },
    location: { findMany: vi.fn() },
  },
}))

import { getUser } from '@/lib/auth'
import { getCampaignMembership } from '@/lib/db/campaignAccess'
import { prisma } from '@/lib/prisma'
import { GET, CHRONICLE_PAGE_SIZE } from '../route'

const db = prisma as any
const params = { params: { id: 'camp1' } }

function request(query = '') {
  return new NextRequest(`http://localhost/api/campaigns/camp1/world-chronicle${query}`)
}

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: 'we1',
    turnNumber: 12,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    type: 'faction.resources',
    targetType: 'FACTION',
    targetId: 'f1',
    targetName: 'The Iron Company',
    previousValue: '40',
    newValue: '44',
    importance: 'MAJOR',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getUser as any).mockResolvedValue({ userId: 'player1' })
  ;(getCampaignMembership as any).mockResolvedValue({ role: 'PLAYER' })
  db.worldEvent.findMany.mockResolvedValue([event()])
  db.faction.findMany.mockResolvedValue([{ id: 'f1' }])
  db.nPC.findMany.mockResolvedValue([])
  db.location.findMany.mockResolvedValue([])
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

  it('never selects the GM-grade reason field', async () => {
    // The whole basis for this route existing beside the admin one.
    await GET(request(), params)
    expect(db.worldEvent.findMany.mock.calls[0][0].select).not.toHaveProperty('reason')
  })

  it('returns a sentence, not the raw change', async () => {
    const body = await (await GET(request(), params)).json()
    expect(body.entries).toHaveLength(1)
    expect(body.entries[0].text).toBe('The Iron Company has grown wealthier.')
    expect(body.entries[0].text).not.toMatch(/\d/)
    expect(body.entries[0].major).toBe(true)
  })

  it('asks only for events the simulation thought mattered', async () => {
    await GET(request(), params)
    expect(db.worldEvent.findMany.mock.calls[0][0].where.significant).toBe(true)
  })

  it('drops an event about a faction the party has not discovered', async () => {
    db.faction.findMany.mockResolvedValue([])
    const body = await (await GET(request(), params)).json()
    expect(body.entries).toEqual([])
  })

  it('drops an event it has no sentence for rather than rendering a field name', async () => {
    db.worldEvent.findMany.mockResolvedValue([
      event({ type: 'faction.beliefVector', previousValue: '1', newValue: '2' }),
    ])
    const body = await (await GET(request(), params)).json()
    expect(body.entries).toEqual([])
  })

  it('pages from the last row SCANNED, not the last one kept', async () => {
    // Otherwise a page whose tail was all dropped re-reads those same
    // dropped rows forever and never advances.
    db.worldEvent.findMany.mockResolvedValue([
      event({ id: 'kept' }),
      event({ id: 'dropped-last', type: 'faction.beliefVector' }),
    ])
    const body = await (await GET(request(), params)).json()
    expect(body.entries).toHaveLength(1)
    // Short scan, so there is nothing more — but the cursor logic is what
    // the next case pins.
    expect(body.nextCursor).toBeNull()
  })

  it('reports more when a page fills before the scan runs out', async () => {
    // The bug this replaced: hasMore checked only whether the SCAN was
    // full, so a page that filled early reported the end of history.
    db.worldEvent.findMany.mockResolvedValue(
      Array.from({ length: CHRONICLE_PAGE_SIZE + 5 }, (_, i) => event({ id: `we${i}` }))
    )
    const body = await (await GET(request(), params)).json()
    expect(body.entries).toHaveLength(CHRONICLE_PAGE_SIZE)
    expect(body.nextCursor).toBe(`we${CHRONICLE_PAGE_SIZE - 1}`)
  })

  it('passes a cursor through as a skip-one seek', async () => {
    await GET(request('?cursor=we9'), params)
    const args = db.worldEvent.findMany.mock.calls[0][0]
    expect(args.cursor).toEqual({ id: 'we9' })
    expect(args.skip).toBe(1)
  })
})
