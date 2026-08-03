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

  it('rejects a lone empty-string description as "no field provided" (falsy, not undefined-checked like universe)', async () => {
    // A real quirk of the validation gate: title/description are checked
    // with `!value` (empty string is falsy) while universe is checked with
    // `=== undefined` — an empty-string description alone can never clear
    // the field through this gate, unlike an explicit universe change.
    ;(getCampaignMembership as any).mockResolvedValue({ role: 'ADMIN' })
    const response = await PATCH(patchRequest({ description: '' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(400)
    expect(db.campaign.update).not.toHaveBeenCalled()
  })

  it('allows clearing universe to an empty string since it is checked against undefined, not falsiness', async () => {
    ;(getCampaignMembership as any).mockResolvedValue({ role: 'ADMIN' })
    db.campaign.update.mockResolvedValue({ id: 'camp1' })

    await PATCH(patchRequest({ universe: '' }), { params: { id: 'camp1' } })

    expect(db.campaign.update).toHaveBeenCalledWith({ where: { id: 'camp1' }, data: { universe: '' } })
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
