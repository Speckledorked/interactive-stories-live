// src/app/api/campaigns/[id]/__tests__/campaignRoute.test.ts
// #93 — PATCH/DELETE on the campaign itself were entirely untested. DELETE
// in particular is the highest-blast-radius destructive route in the app
// (cascades across every piece of campaign data), and both routes use an
// inline `membership.role !== 'ADMIN'` check rather than the shared
// requireCampaignAdmin helper the rest of the app uses — worth pinning
// down with a real test rather than leaving that inconsistency unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({ getCampaignMembership: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: { update: vi.fn(), delete: vi.fn() },
  },
}))

import { requireAuth } from '@/lib/auth'
import { getCampaignMembership } from '@/lib/db/campaignAccess'
import { prisma } from '@/lib/prisma'
import { PATCH, DELETE } from '../route'

const db = prisma as any

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

beforeEach(() => {
  vi.clearAllMocks()
  ;(requireAuth as any).mockResolvedValue({ userId: 'admin1', email: 'admin@example.com' })
})

describe('PATCH', () => {
  it('rejects a non-member', async () => {
    ;(getCampaignMembership as any).mockResolvedValue(null)
    const response = await PATCH(patchRequest({ title: 'New Title' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
    expect(db.campaign.update).not.toHaveBeenCalled()
  })

  it('rejects a non-admin member', async () => {
    ;(getCampaignMembership as any).mockResolvedValue({ role: 'PLAYER' })
    const response = await PATCH(patchRequest({ title: 'New Title' }), { params: { id: 'camp1' } })
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

    expect(response.status).toBe(200)
    expect(db.campaign.update).toHaveBeenCalledWith({ where: { id: 'camp1' }, data: { title: 'New Title' } })
  })

  // #370: these three used to pin the quirk rather than the intent — the
  // gate mixed `!value` for title/description with `=== undefined` for
  // universe, and the assignments below it used `!== undefined` for all
  // three. Presence and emptiness are separate checks now, so each field
  // states its own rule and these assert that rule.
  it('clears a description, which used to be impossible', async () => {
    ;(getCampaignMembership as any).mockResolvedValue({ role: 'ADMIN' })
    db.campaign.update.mockResolvedValue({ id: 'camp1' })

    await PATCH(patchRequest({ description: '' }), { params: { id: 'camp1' } })

    expect(db.campaign.update).toHaveBeenCalledWith({ where: { id: 'camp1' }, data: { description: '' } })
  })

  it('allows clearing universe to an empty string', async () => {
    ;(getCampaignMembership as any).mockResolvedValue({ role: 'ADMIN' })
    db.campaign.update.mockResolvedValue({ id: 'camp1' })

    await PATCH(patchRequest({ universe: '' }), { params: { id: 'camp1' } })

    expect(db.campaign.update).toHaveBeenCalledWith({ where: { id: 'camp1' }, data: { universe: '' } })
  })

  it('rejects an empty title with a message that says why', async () => {
    ;(getCampaignMembership as any).mockResolvedValue({ role: 'ADMIN' })

    const response = await PATCH(patchRequest({ title: '   ' }), { params: { id: 'camp1' } })
    const body = await response.json()

    expect(response.status).toBe(400)
    // Not "At least one field must be provided" — that misreported WHY.
    expect(body.error).toBe('Title cannot be empty')
    expect(db.campaign.update).not.toHaveBeenCalled()
  })

  it('rejects an empty title even when another field carries the request (#370)', async () => {
    // The hole the issue missed. The old gate was one `&&` chain: a truthy
    // description short-circuited it, and the assignment below only checked
    // for undefined — so an empty title was unreachable alone and reachable
    // in company. A campaign could be silently renamed to "".
    ;(getCampaignMembership as any).mockResolvedValue({ role: 'ADMIN' })

    const response = await PATCH(
      patchRequest({ title: '', description: 'still here' }),
      { params: { id: 'camp1' } }
    )

    expect(response.status).toBe(400)
    expect(db.campaign.update).not.toHaveBeenCalled()
  })

  it('still rejects a request that names no field at all', async () => {
    ;(getCampaignMembership as any).mockResolvedValue({ role: 'ADMIN' })

    const response = await PATCH(patchRequest({}), { params: { id: 'camp1' } })
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe('At least one field must be provided')
    expect(db.campaign.update).not.toHaveBeenCalled()
  })
})

describe('DELETE', () => {
  it('rejects a non-member', async () => {
    ;(getCampaignMembership as any).mockResolvedValue(null)
    const response = await DELETE(deleteRequest(), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
    expect(db.campaign.delete).not.toHaveBeenCalled()
  })

  it('rejects a non-admin member', async () => {
    ;(getCampaignMembership as any).mockResolvedValue({ role: 'PLAYER' })
    const response = await DELETE(deleteRequest(), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
    expect(db.campaign.delete).not.toHaveBeenCalled()
  })

  it('deletes the campaign for an admin', async () => {
    ;(getCampaignMembership as any).mockResolvedValue({ role: 'ADMIN' })
    db.campaign.delete.mockResolvedValue({ id: 'camp1' })

    const response = await DELETE(deleteRequest(), { params: { id: 'camp1' } })

    expect(response.status).toBe(200)
    expect(db.campaign.delete).toHaveBeenCalledWith({ where: { id: 'camp1' } })
  })

  it('returns a generic 500 (not the raw error) when the delete throws', async () => {
    ;(getCampaignMembership as any).mockResolvedValue({ role: 'ADMIN' })
    db.campaign.delete.mockRejectedValue(new Error('P2003 Foreign key constraint failed'))

    const response = await DELETE(deleteRequest(), { params: { id: 'camp1' } })

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.error).toBe('Internal server error')
  })
})
