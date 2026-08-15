// src/app/api/campaigns/[id]/audit-log/__tests__/route.test.ts
// #289 — StateMutation/LoreCitation/AIValidationFailure had real writers
// and no reader anywhere. Same admin-gate + bounded-query test shape as
// world-events' own route test.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ getUser: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({ requireCampaignAdmin: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    stateMutation: { findMany: vi.fn() },
    loreCitation: { findMany: vi.fn() },
    aIValidationFailure: { findMany: vi.fn() },
  },
}))

import { getUser } from '@/lib/auth'
import { requireCampaignAdmin } from '@/lib/db/campaignAccess'
import { prisma } from '@/lib/prisma'
import { GET } from '../route'

const db = prisma as any

function req(query = '') {
  return new NextRequest(`http://localhost/api/campaigns/camp1/audit-log${query}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getUser as any).mockResolvedValue({ userId: 'admin1' })
  ;(requireCampaignAdmin as any).mockResolvedValue({ membership: { role: 'ADMIN' } })
  db.stateMutation.findMany.mockResolvedValue([])
  db.loreCitation.findMany.mockResolvedValue([])
  db.aIValidationFailure.findMany.mockResolvedValue([])
})

describe('GET', () => {
  it('rejects an unauthenticated request', async () => {
    ;(getUser as any).mockResolvedValue(null)
    const response = await GET(req(), { params: { id: 'camp1' } })
    expect(response.status).toBe(401)
  })

  it('rejects a non-admin', async () => {
    ;(requireCampaignAdmin as any).mockResolvedValue({ response: new Response(null, { status: 403 }) })
    const response = await GET(req(), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
    expect(db.stateMutation.findMany).not.toHaveBeenCalled()
    expect(db.loreCitation.findMany).not.toHaveBeenCalled()
    expect(db.aIValidationFailure.findMany).not.toHaveBeenCalled()
  })

  it('queries all three tables unfiltered when no sceneId is given', async () => {
    await GET(req(), { params: { id: 'camp1' } })
    expect(db.stateMutation.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { campaignId: 'camp1' } }))
    expect(db.loreCitation.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { campaignId: 'camp1' } }))
    expect(db.aIValidationFailure.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { campaignId: 'camp1' } }))
  })

  it('filters all three tables to the requested sceneId', async () => {
    await GET(req('?sceneId=scene1'), { params: { id: 'camp1' } })
    expect(db.stateMutation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { campaignId: 'camp1', sceneId: 'scene1' },
    }))
    expect(db.loreCitation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { campaignId: 'camp1', sceneId: 'scene1' },
    }))
    expect(db.aIValidationFailure.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { campaignId: 'camp1', sceneId: 'scene1' },
    }))
  })

  it('caps each query at the row limit, most recent first', async () => {
    await GET(req(), { params: { id: 'camp1' } })
    expect(db.stateMutation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: { createdAt: 'desc' },
      take: 50,
    }))
  })

  it('returns the real data shape from all three tables', async () => {
    db.stateMutation.findMany.mockResolvedValue([{ id: 'sm1', field: 'goals', result: 'REJECTED' }])
    db.loreCitation.findMany.mockResolvedValue([{ id: 'lc1', loreEntryId: 'lore1', similarity: 0.9 }])
    db.aIValidationFailure.findMany.mockResolvedValue([{ id: 'vf1', errorSummary: 'bad shape' }])

    const response = await GET(req(), { params: { id: 'camp1' } })
    const body = await response.json()

    expect(body.stateMutations).toEqual([{ id: 'sm1', field: 'goals', result: 'REJECTED' }])
    expect(body.loreCitations).toEqual([{ id: 'lc1', loreEntryId: 'lore1', similarity: 0.9 }])
    expect(body.validationFailures).toEqual([{ id: 'vf1', errorSummary: 'bad shape' }])
  })
})
