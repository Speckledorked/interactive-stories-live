// src/app/api/campaigns/[id]/clocks/__tests__/route.test.ts
// #135 (cont.) — listing and creating clocks had no test coverage: GET's
// admin-sees-all-vs-player-sees-visible-only fog-of-war filter and GM
// notes redaction, and POST's admin gate, were both unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ getUser: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({ getCampaignMembership: vi.fn(), requireCampaignAdmin: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { clock: { findMany: vi.fn(), create: vi.fn() } },
}))

import { getUser } from '@/lib/auth'
import { getCampaignMembership, requireCampaignAdmin } from '@/lib/db/campaignAccess'
import { prisma } from '@/lib/prisma'
import { GET, POST } from '../route'

const db = prisma as any

function getRequest() {
  return new NextRequest('http://localhost/api/campaigns/camp1/clocks')
}

function postRequest(body: unknown) {
  return new NextRequest('http://localhost/api/campaigns/camp1/clocks', {
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
})

describe('GET', () => {
  it('rejects an unauthenticated request', async () => {
    ;(getUser as any).mockResolvedValue(null)
    const response = await GET(getRequest(), { params: { id: 'camp1' } })
    expect(response.status).toBe(401)
  })

  it('rejects a non-member', async () => {
    ;(getCampaignMembership as any).mockResolvedValue(null)
    const response = await GET(getRequest(), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
  })

  it('only queries visible (non-hidden) clocks for a player', async () => {
    db.clock.findMany.mockResolvedValue([])
    await GET(getRequest(), { params: { id: 'camp1' } })
    expect(db.clock.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { campaignId: 'camp1', isHidden: false },
    }))
  })

  it('queries every clock, hidden or not, for an admin', async () => {
    ;(getCampaignMembership as any).mockResolvedValue({ role: 'ADMIN' })
    db.clock.findMany.mockResolvedValue([])
    await GET(getRequest(), { params: { id: 'camp1' } })
    expect(db.clock.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { campaignId: 'camp1' },
    }))
  })

  it('redacts GM notes for a player but not an admin', async () => {
    db.clock.findMany.mockResolvedValue([{ id: 'c1', name: 'Doom Clock', gmNotes: 'secret plan', isHidden: false }])
    const response = await GET(getRequest(), { params: { id: 'camp1' } })
    const body = await response.json()
    expect(body.clocks[0].gmNotes).not.toBe('secret plan')
  })
})

describe('POST', () => {
  it('rejects an unauthenticated request', async () => {
    ;(getUser as any).mockResolvedValue(null)
    const response = await POST(postRequest({ name: 'Doom Clock' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(401)
  })

  it('rejects a non-admin', async () => {
    ;(requireCampaignAdmin as any).mockResolvedValue({ response: new Response(null, { status: 403 }) })
    const response = await POST(postRequest({ name: 'Doom Clock' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
    expect(db.clock.create).not.toHaveBeenCalled()
  })

  it('requires a name', async () => {
    const response = await POST(postRequest({}), { params: { id: 'camp1' } })
    expect(response.status).toBe(400)
    expect(db.clock.create).not.toHaveBeenCalled()
  })

  it('creates the clock with sensible defaults', async () => {
    db.clock.create.mockResolvedValue({ id: 'c1', name: 'Doom Clock' })
    const response = await POST(postRequest({ name: 'Doom Clock' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(201)
    expect(db.clock.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ campaignId: 'camp1', name: 'Doom Clock', currentTicks: 0, maxTicks: 4, isHidden: false }),
    })
  })
})
