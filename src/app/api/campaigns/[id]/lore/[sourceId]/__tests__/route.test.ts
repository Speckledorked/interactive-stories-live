// src/app/api/campaigns/[id]/lore/[sourceId]/__tests__/route.test.ts
// #135 (cont.) — deleting a lore source had no test coverage: the
// admin-only gate, and that a sourceId from a DIFFERENT campaign 404s
// rather than deleting across campaigns (the deleteMany where-clause
// scopes on both id and campaignId together), were both unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ getUser: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({ requireCampaignAdmin: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { loreImportJob: { deleteMany: vi.fn() } },
}))

import { getUser } from '@/lib/auth'
import { requireCampaignAdmin } from '@/lib/db/campaignAccess'
import { prisma } from '@/lib/prisma'
import { DELETE } from '../route'

const db = prisma as any

function req() {
  return new NextRequest('http://localhost/api/campaigns/camp1/lore/source1', { method: 'DELETE' })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getUser as any).mockResolvedValue({ userId: 'admin1' })
  ;(requireCampaignAdmin as any).mockResolvedValue({ membership: { role: 'ADMIN' } })
})

describe('DELETE', () => {
  it('rejects an unauthenticated request', async () => {
    ;(getUser as any).mockResolvedValue(null)
    const response = await DELETE(req(), { params: { id: 'camp1', sourceId: 'source1' } })
    expect(response.status).toBe(401)
  })

  it('rejects a non-admin', async () => {
    ;(requireCampaignAdmin as any).mockResolvedValue({ response: new Response(null, { status: 403 }) })
    const response = await DELETE(req(), { params: { id: 'camp1', sourceId: 'source1' } })
    expect(response.status).toBe(403)
    expect(db.loreImportJob.deleteMany).not.toHaveBeenCalled()
  })

  it('404s for a source from a different campaign rather than deleting across campaigns', async () => {
    db.loreImportJob.deleteMany.mockResolvedValue({ count: 0 })
    const response = await DELETE(req(), { params: { id: 'camp1', sourceId: 'source1' } })
    expect(response.status).toBe(404)
    expect(db.loreImportJob.deleteMany).toHaveBeenCalledWith({ where: { id: 'source1', campaignId: 'camp1' } })
  })

  it('deletes a source that belongs to the campaign', async () => {
    db.loreImportJob.deleteMany.mockResolvedValue({ count: 1 })
    const response = await DELETE(req(), { params: { id: 'camp1', sourceId: 'source1' } })
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body).toEqual({ success: true })
  })

  it('returns 500 on an unexpected error', async () => {
    db.loreImportJob.deleteMany.mockRejectedValue(new Error('db down'))
    const response = await DELETE(req(), { params: { id: 'camp1', sourceId: 'source1' } })
    expect(response.status).toBe(500)
  })
})
