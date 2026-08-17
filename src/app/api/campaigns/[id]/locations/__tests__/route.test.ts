// src/app/api/campaigns/[id]/locations/__tests__/route.test.ts
// #135 (cont.) — the location list/create route had no test coverage:
// the membership gate on GET vs. the admin-only gate on POST, and that
// GM notes are redacted for a non-admin but not an admin, were both
// unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ getUser: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({
  getCampaignMembership: vi.fn(),
  requireCampaignAdmin: vi.fn(),
}))
vi.mock('@/lib/api/visibility', () => ({
  visibleTo: vi.fn(() => ({})),
  isCampaignAdmin: vi.fn((role: string) => role === 'ADMIN'),
}))
vi.mock('@/lib/game/visibility', () => ({
  redactGmNotesList: vi.fn((list: any, isAdmin: boolean) => isAdmin ? list : list.map((l: any) => ({ ...l, gmNotes: null }))),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    location: { findMany: vi.fn(), create: vi.fn() },
    locationAdjacency: { createMany: vi.fn(async () => ({ count: 2 })) },
  },
}))

import { getUser } from '@/lib/auth'
import { getCampaignMembership, requireCampaignAdmin } from '@/lib/db/campaignAccess'
import { prisma } from '@/lib/prisma'
import { GET, POST } from '../route'

const db = prisma as any

function getRequest() {
  return new NextRequest('http://localhost/api/campaigns/camp1/locations')
}

function postRequest(body: unknown) {
  return new NextRequest('http://localhost/api/campaigns/camp1/locations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getUser as any).mockResolvedValue({ userId: 'player1' })
  ;(getCampaignMembership as any).mockResolvedValue({ role: 'PLAYER' })
  ;(requireCampaignAdmin as any).mockResolvedValue({ membership: { role: 'ADMIN' } })
  db.location.findMany.mockResolvedValue([{ id: 'l1', name: 'Old Mill', gmNotes: 'secret' }])
})

describe('GET', () => {
  it('rejects a non-member', async () => {
    ;(getCampaignMembership as any).mockResolvedValue(null)
    const response = await GET(getRequest(), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
  })

  it('redacts gmNotes for a non-admin', async () => {
    const response = await GET(getRequest(), { params: { id: 'camp1' } })
    const body = await response.json()
    expect(body.locations[0].gmNotes).toBeNull()
  })

  it('does not redact gmNotes for an admin', async () => {
    ;(getCampaignMembership as any).mockResolvedValue({ role: 'ADMIN' })
    const response = await GET(getRequest(), { params: { id: 'camp1' } })
    const body = await response.json()
    expect(body.locations[0].gmNotes).toBe('secret')
  })
})

describe('POST', () => {
  it('rejects a non-admin', async () => {
    ;(requireCampaignAdmin as any).mockResolvedValue({ response: new Response(null, { status: 403 }) })
    const response = await POST(postRequest({ name: 'Old Mill' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
    expect(db.location.create).not.toHaveBeenCalled()
  })

  it('requires a name', async () => {
    const response = await POST(postRequest({}), { params: { id: 'camp1' } })
    expect(response.status).toBe(400)
    expect(db.location.create).not.toHaveBeenCalled()
  })

  it('creates the location', async () => {
    db.location.create.mockResolvedValue({ id: 'l1', name: 'Old Mill' })
    const response = await POST(postRequest({ name: 'Old Mill' }), { params: { id: 'camp1' } })
    const body = await response.json()
    expect(response.status).toBe(201)
    expect(body.location).toEqual({ id: 'l1', name: 'Old Mill' })
  })

  // #445 (F-04): this route was the one creation path #378 and #379 both
  // missed — the hand-authoring surface an admin actually uses. A location
  // created here produced nothing (logisticsTick's extraction and
  // supply-route passes both open with `if (resourceSlots.length === 0)
  // continue`) and had no edges (every graph reader falls back silently on
  // an unreachable node). It looked entirely real in the UI and did not
  // exist to the simulation.
  it('derives resource slots from what the admin actually typed', async () => {
    db.location.create.mockResolvedValue({ id: 'l1', name: 'Ironhold Mine' })
    await POST(postRequest({ name: 'Ironhold Mine' }), { params: { id: 'camp1' } })

    expect(db.location.create.mock.calls[0][0].data.resourceSlots).toEqual(['ore'])
  })

  it('never creates a location that produces nothing by accident', async () => {
    // The settlement default. An empty array is a real answer for a ruin,
    // and must not also be the answer for "the admin phrased it unusually".
    db.location.create.mockResolvedValue({ id: 'l1', name: 'Thrennish Hollow' })
    await POST(postRequest({ name: 'Thrennish Hollow' }), { params: { id: 'camp1' } })

    expect(db.location.create.mock.calls[0][0].data.resourceSlots).toEqual(['grain'])
  })

  it('attaches the new location to the world graph', async () => {
    db.location.create.mockResolvedValue({ id: 'l9', name: 'Old Mill' })
    db.location.findMany.mockResolvedValue([{ id: 'l1' }, { id: 'l2' }, { id: 'l9' }])

    await POST(postRequest({ name: 'Old Mill' }), { params: { id: 'camp1' } })

    const rows = db.locationAdjacency.createMany.mock.calls[0][0].data
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.campaignId).toBe('camp1')
      expect(row.locationAId === 'l9' || row.locationBId === 'l9').toBe(true)
    }
  })

  it('still returns the location when the graph write fails', async () => {
    db.location.create.mockResolvedValue({ id: 'l9', name: 'Old Mill' })
    db.location.findMany.mockResolvedValue([{ id: 'l1' }, { id: 'l9' }])
    db.locationAdjacency.createMany.mockRejectedValueOnce(new Error('db down'))

    const response = await POST(postRequest({ name: 'Old Mill' }), { params: { id: 'camp1' } })

    expect(response.status).toBe(201)
  })
})

// #426, found by mutation audit: flipping this route's `status: 401` to
// `status: 200` did not fail a single test, because no test ever set
// getUser to null. The unauthenticated branch — the most basic guarantee
// the route makes — was never executed. Every other assertion in this file
// runs as a signed-in user, so the 401 was structurally unreachable by the
// suite that was said to cover it.
describe('unauthenticated access (#426)', () => {
  it('rejects a caller with no session', async () => {
    ;(getUser as any).mockResolvedValue(null)

    const response = await GET(getRequest(), { params: { id: 'camp1' } })

    expect(response.status).toBe(401)
  })
})
