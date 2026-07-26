// src/app/api/campaigns/[id]/__tests__/fogRoutes.test.ts
//
// Fog of war, verified through the routes themselves (#95).
//
// #94 made the rule structural: one `visibleTo()` helper, and a test that
// fails if a new route reads a gated model without it. That proves the
// helper is *reached*. It does not prove the routes *behave* — a route can
// import the helper and still hand the result to the wrong query, or gate
// the list and leak through a second one.
//
// This is the behavioural half, and it goes first among the route tests
// because it is the claim the product leads with: "hidden factions, NPCs
// and locations never reach player-facing responses — enforced at the query
// layer, not just the UI." Six route test files for 93 routes was the
// score-1 finding; these are the six that carry that sentence.
//
// Each case asks the question a player's client actually asks, and checks
// what comes back over the wire.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaignMembership: { findUnique: vi.fn(), findFirst: vi.fn() },
    campaign: { findUnique: vi.fn() },
    nPC: { findMany: vi.fn(async () => []) },
    faction: { findMany: vi.fn(async () => []) },
    location: { findMany: vi.fn(async () => []) },
    clock: { findMany: vi.fn(async () => []) },
  },
}))
// The routes reach for three different auth helpers — getUser on the
// collection routes, requireAuth (synchronous, throws) on the aggregate.
// All three are mocked so a missing one surfaces as a test failure rather
// than a 500 that looks like a passing 403.
vi.mock('@/lib/auth', () => ({
  getUser: vi.fn(),
  verifyAuth: vi.fn(),
  requireAuth: vi.fn(),
}))

import { prisma } from '@/lib/prisma'
import { getUser, requireAuth } from '@/lib/auth'
import { GET as getNpcs } from '../npcs/route'
import { GET as getFactions } from '../factions/route'
import { GET as getLocations } from '../locations/route'
import { GET as getClocks } from '../clocks/route'
import { GET as getCampaign } from '../route'

const db = prisma as any
const params = { params: { id: 'camp1' } }
const req = (path = 'npcs') => new NextRequest(`http://localhost/api/campaigns/camp1/${path}`)

/** Every entity list route, so no gated collection is left unasked. */
const COLLECTIONS = [
  { name: 'npcs', handler: getNpcs, model: 'nPC', gate: { isDiscovered: true } },
  { name: 'factions', handler: getFactions, model: 'faction', gate: { isDiscovered: true } },
  { name: 'locations', handler: getLocations, model: 'location', gate: { isDiscovered: true } },
  // The odd one out, and the reason the helper exists: clocks gate on the
  // opposite column with the opposite polarity.
  { name: 'clocks', handler: getClocks, model: 'clock', gate: { isHidden: false } },
] as const

const asRole = (role: string | null) => {
  const user = { userId: 'u1', email: 'p@example.com' }
  ;(getUser as any).mockResolvedValue(user)
  ;(requireAuth as any).mockReturnValue(user)
  db.campaignMembership.findUnique.mockResolvedValue(role ? { id: 'm1', role } : null)
  db.campaignMembership.findFirst.mockResolvedValue(role ? { id: 'm1', role } : null)
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const { model } of COLLECTIONS) db[model].findMany.mockResolvedValue([])
  db.campaign.findUnique.mockResolvedValue({
    id: 'camp1', name: 'Test', characters: [], npcs: [], factions: [],
    locations: [], clocks: [], timeline: [], scenes: [], memberships: [], worldMeta: null,
  })
})

describe.each(COLLECTIONS)('GET /$name — fog of war', ({ name, handler, model, gate }) => {
  it('restricts a player to what the party has found', async () => {
    asRole('PLAYER')
    await handler(req(name), params)

    const where = db[model].findMany.mock.calls[0][0].where
    expect(where).toMatchObject({ campaignId: 'camp1', ...gate })
  })

  it('shows an admin everything, so they can manage it', async () => {
    asRole('ADMIN')
    await handler(req(name), params)

    const where = db[model].findMany.mock.calls[0][0].where
    for (const key of Object.keys(gate)) {
      expect(where, `admin query still filtering on ${key}`).not.toHaveProperty(key)
    }
  })

  it('refuses a non-member outright, without querying at all', async () => {
    // 403 before the query, not an empty list after it: a non-member should
    // not be able to learn a campaign's shape from response timing either.
    asRole(null)
    const res = await handler(req(name), params)

    expect(res.status).toBe(403)
    expect(db[model].findMany).not.toHaveBeenCalled()
  })

  it('refuses an unauthenticated caller', async () => {
    ;(getUser as any).mockResolvedValue(null)
    const res = await handler(req(name), params)

    expect(res.status).toBe(401)
    expect(db[model].findMany).not.toHaveBeenCalled()
  })

  it('never sends an unfiltered query for any role but ADMIN', async () => {
    // The invariant underneath the specific cases: an unrecognised or
    // malformed role must fail closed rather than being treated as staff.
    for (const role of ['PLAYER', 'OWNER', 'admin', 'GUEST']) {
      vi.clearAllMocks()
      db[model].findMany.mockResolvedValue([])
      asRole(role)
      await handler(req(name), params)

      const where = db[model].findMany.mock.calls[0][0].where
      const gated = Object.keys(gate).some(k => k in where)
      expect(gated, `role "${role}" got an unfiltered ${name} query`).toBe(true)
    }
  })
})

describe('GET /campaigns/[id] — the aggregate route', () => {
  // The single most important fog-gated route in the app: it returns all
  // four models at once through nested includes, and it is what the story
  // page loads on every poll. It is also the route the first version of
  // #94's structural check missed entirely.
  const relationWhere = (relation: string) =>
    db.campaign.findUnique.mock.calls[0][0].include[relation].where

  it('gates every gated relation for a player, in one request', async () => {
    asRole('PLAYER')
    await getCampaign(req(''), params)

    expect(relationWhere('npcs')).toEqual({ isDiscovered: true })
    expect(relationWhere('factions')).toEqual({ isDiscovered: true })
    expect(relationWhere('locations')).toEqual({ isDiscovered: true })
    expect(relationWhere('clocks')).toEqual({ isHidden: false })
  })

  it('opens all of them for an admin', async () => {
    asRole('ADMIN')
    await getCampaign(req(''), params)

    for (const relation of ['npcs', 'factions', 'locations', 'clocks']) {
      expect(relationWhere(relation), relation).toEqual({})
    }
  })

  it('does not leak the campaign to a non-member', async () => {
    asRole(null)
    const res = await getCampaign(req(''), params)

    expect(res.status).toBe(403)
    expect(db.campaign.findUnique).not.toHaveBeenCalled()
  })
})
