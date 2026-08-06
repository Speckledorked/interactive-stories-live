// src/app/api/campaigns/[id]/__tests__/route.test.ts
// #135 (cont.) — the single-campaign read/update/delete route had no
// test coverage: the membership gate on all three verbs, PATCH/DELETE's
// admin-only escalation beyond plain membership, PATCH's "at least one
// field" validation, and GET's live world-seeding re-check (self-healing
// a stale pendingWorldSeed flag), were all unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({ getCampaignMembership: vi.fn() }))
vi.mock('@/lib/api/visibility', () => ({ visibleTo: vi.fn(() => ({})) }))
vi.mock('@/lib/game/visibility', () => ({
  redactGmNotes: vi.fn((x: any) => x),
  redactGmNotesList: vi.fn((list: any) => list),
}))
vi.mock('@/lib/lore/seedingGate', () => ({ isWorldSeeding: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { campaign: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() } },
}))

import { requireAuth } from '@/lib/auth'
import { getCampaignMembership } from '@/lib/db/campaignAccess'
import { isWorldSeeding } from '@/lib/lore/seedingGate'
import { prisma } from '@/lib/prisma'
import { GET, PATCH, DELETE } from '../route'

const db = prisma as any

function getRequest() {
  return new NextRequest('http://localhost/api/campaigns/camp1')
}

function patchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/campaigns/camp1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function deleteRequest() {
  return new NextRequest('http://localhost/api/campaigns/camp1', { method: 'DELETE' })
}

const baseCampaign = {
  id: 'camp1', pendingWorldSeed: false, worldMeta: null,
  characters: [], npcs: [], factions: [], locations: [], clocks: [], timeline: [],
  scenes: [], memberships: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(requireAuth as any).mockResolvedValue({ userId: 'u1' })
  ;(getCampaignMembership as any).mockResolvedValue({ role: 'PLAYER' })
  ;(isWorldSeeding as any).mockResolvedValue(false)
  db.campaign.findUnique.mockResolvedValue(baseCampaign)
})

describe('GET', () => {
  it('rejects an unauthenticated request', async () => {
    ;(requireAuth as any).mockRejectedValue(new Error('Unauthorized'))
    const response = await GET(getRequest(), { params: { id: 'camp1' } })
    expect(response.status).toBe(401)
  })

  it('rejects a non-member', async () => {
    ;(getCampaignMembership as any).mockResolvedValue(null)
    const response = await GET(getRequest(), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
  })

  it('returns 404 for a missing campaign', async () => {
    db.campaign.findUnique.mockResolvedValue(null)
    const response = await GET(getRequest(), { params: { id: 'camp1' } })
    expect(response.status).toBe(404)
  })

  it('re-checks a stale pendingWorldSeed flag live rather than trusting the stored value', async () => {
    db.campaign.findUnique.mockResolvedValue({ ...baseCampaign, pendingWorldSeed: true })
    ;(isWorldSeeding as any).mockResolvedValue(false)
    const response = await GET(getRequest(), { params: { id: 'camp1' } })
    const body = await response.json()
    expect(isWorldSeeding).toHaveBeenCalledWith('camp1')
    expect(body.campaign.pendingWorldSeed).toBe(false)
  })

  it('returns the caller\'s role alongside the campaign', async () => {
    const response = await GET(getRequest(), { params: { id: 'camp1' } })
    const body = await response.json()
    expect(body.userRole).toBe('PLAYER')
  })
})

describe('PATCH', () => {
  it('rejects a non-member', async () => {
    ;(getCampaignMembership as any).mockResolvedValue(null)
    const response = await PATCH(patchRequest({ title: 'New' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
  })

  it('rejects a member who is not an admin', async () => {
    const response = await PATCH(patchRequest({ title: 'New' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
    expect(db.campaign.update).not.toHaveBeenCalled()
  })

  it('requires at least one field', async () => {
    ;(getCampaignMembership as any).mockResolvedValue({ role: 'ADMIN' })
    const response = await PATCH(patchRequest({}), { params: { id: 'camp1' } })
    expect(response.status).toBe(400)
    expect(db.campaign.update).not.toHaveBeenCalled()
  })

  it('updates only the provided fields', async () => {
    ;(getCampaignMembership as any).mockResolvedValue({ role: 'ADMIN' })
    db.campaign.update.mockResolvedValue({ id: 'camp1', title: 'New Title' })
    const response = await PATCH(patchRequest({ title: 'New Title' }), { params: { id: 'camp1' } })
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.campaign).toEqual({ id: 'camp1', title: 'New Title' })
    expect(db.campaign.update).toHaveBeenCalledWith({ where: { id: 'camp1' }, data: { title: 'New Title' } })
  })
})

describe('DELETE', () => {
  it('rejects a non-admin', async () => {
    const response = await DELETE(deleteRequest(), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
    expect(db.campaign.delete).not.toHaveBeenCalled()
  })

  it('deletes the campaign for an admin', async () => {
    ;(getCampaignMembership as any).mockResolvedValue({ role: 'ADMIN' })
    const response = await DELETE(deleteRequest(), { params: { id: 'camp1' } })
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body).toEqual({ success: true })
    expect(db.campaign.delete).toHaveBeenCalledWith({ where: { id: 'camp1' } })
  })
})
