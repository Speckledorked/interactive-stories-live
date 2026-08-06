// src/app/api/campaigns/[id]/npcs/__tests__/route.test.ts
// #135 (cont.) — the NPC list/create route had no test coverage: the
// membership gate on GET vs. the admin-only gate on POST, GM-notes
// redaction for a non-admin, and that a new NPC's discovery intent
// (not a hardcoded true) is what's passed through when resolving its
// location, were all unverified.

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
  redactGmNotesList: vi.fn((list: any, isAdmin: boolean) => isAdmin ? list : list.map((n: any) => ({ ...n, gmNotes: null }))),
}))
vi.mock('@/lib/game/worldUpdaters/locations', () => ({ resolveOrCreateLocationId: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { nPC: { findMany: vi.fn(), create: vi.fn() } },
}))

import { getUser } from '@/lib/auth'
import { getCampaignMembership, requireCampaignAdmin } from '@/lib/db/campaignAccess'
import { resolveOrCreateLocationId } from '@/lib/game/worldUpdaters/locations'
import { prisma } from '@/lib/prisma'
import { GET, POST } from '../route'

const db = prisma as any

function getRequest() {
  return new NextRequest('http://localhost/api/campaigns/camp1/npcs')
}

function postRequest(body: unknown) {
  return new NextRequest('http://localhost/api/campaigns/camp1/npcs', {
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
  ;(resolveOrCreateLocationId as any).mockResolvedValue('loc1')
  db.nPC.findMany.mockResolvedValue([{ id: 'n1', name: 'Rowan', gmNotes: 'secret' }])
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
    expect(body.npcs[0].gmNotes).toBeNull()
  })
})

describe('POST', () => {
  it('rejects a non-admin', async () => {
    ;(requireCampaignAdmin as any).mockResolvedValue({ response: new Response(null, { status: 403 }) })
    const response = await POST(postRequest({ name: 'Rowan' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
    expect(db.nPC.create).not.toHaveBeenCalled()
  })

  it('requires a name', async () => {
    const response = await POST(postRequest({}), { params: { id: 'camp1' } })
    expect(response.status).toBe(400)
    expect(db.nPC.create).not.toHaveBeenCalled()
  })

  it('resolves the location using the NPC\'s own discovery intent, not a hardcoded true', async () => {
    await POST(postRequest({ name: 'Rowan', currentLocation: 'The Docks', isDiscovered: false }), { params: { id: 'camp1' } })
    expect(resolveOrCreateLocationId).toHaveBeenCalledWith(expect.anything(), 'camp1', 'The Docks', false)
  })

  it('creates the NPC', async () => {
    db.nPC.create.mockResolvedValue({ id: 'n1', name: 'Rowan' })
    const response = await POST(postRequest({ name: 'Rowan' }), { params: { id: 'camp1' } })
    const body = await response.json()
    expect(response.status).toBe(201)
    expect(body.npc).toEqual({ id: 'n1', name: 'Rowan' })
  })
})
