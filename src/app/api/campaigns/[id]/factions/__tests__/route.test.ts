// src/app/api/campaigns/[id]/factions/__tests__/route.test.ts
// #135 (cont.) — the faction list/create route had no test coverage:
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
  redactGmNotesList: vi.fn((list: any, isAdmin: boolean) => isAdmin ? list : list.map((f: any) => ({ ...f, gmNotes: null }))),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: { faction: { findMany: vi.fn(), create: vi.fn() } },
}))

import { getUser } from '@/lib/auth'
import { getCampaignMembership, requireCampaignAdmin } from '@/lib/db/campaignAccess'
import { prisma } from '@/lib/prisma'
import { GET, POST } from '../route'

const db = prisma as any

function getRequest() {
  return new NextRequest('http://localhost/api/campaigns/camp1/factions')
}

function postRequest(body: unknown) {
  return new NextRequest('http://localhost/api/campaigns/camp1/factions', {
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
  db.faction.findMany.mockResolvedValue([{ id: 'f1', name: 'Guild', gmNotes: 'secret' }])
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
    expect(body.factions[0].gmNotes).toBeNull()
  })

  it('does not redact gmNotes for an admin', async () => {
    ;(getCampaignMembership as any).mockResolvedValue({ role: 'ADMIN' })
    const response = await GET(getRequest(), { params: { id: 'camp1' } })
    const body = await response.json()
    expect(body.factions[0].gmNotes).toBe('secret')
  })
})

describe('POST', () => {
  it('rejects a non-admin', async () => {
    ;(requireCampaignAdmin as any).mockResolvedValue({ response: new Response(null, { status: 403 }) })
    const response = await POST(postRequest({ name: 'Guild' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
    expect(db.faction.create).not.toHaveBeenCalled()
  })

  it('requires a name', async () => {
    const response = await POST(postRequest({}), { params: { id: 'camp1' } })
    expect(response.status).toBe(400)
    expect(db.faction.create).not.toHaveBeenCalled()
  })

  it('creates the faction with sensible defaults', async () => {
    db.faction.create.mockResolvedValue({ id: 'f1', name: 'Guild' })
    const response = await POST(postRequest({ name: 'Guild' }), { params: { id: 'camp1' } })
    const body = await response.json()
    expect(response.status).toBe(201)
    expect(body.faction).toEqual({ id: 'f1', name: 'Guild' })
    expect(db.faction.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ resources: 50, influence: 50, threatLevel: 1, isDiscovered: true }),
    }))
  })
})
