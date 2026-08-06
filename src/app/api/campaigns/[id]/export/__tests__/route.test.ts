// src/app/api/campaigns/[id]/export/__tests__/route.test.ts
// #135 (cont.) — the campaign data export had no test coverage: the
// membership gate, and that each `?include=false` query flag actually
// turns off the corresponding section, were both unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ verifyAuth: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({ getCampaignMembership: vi.fn() }))
vi.mock('@/lib/export/campaign-exporter', () => ({
  CampaignExporter: { exportCampaign: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({
  prisma: { campaign: { findUnique: vi.fn() } },
}))

import { verifyAuth } from '@/lib/auth'
import { getCampaignMembership } from '@/lib/db/campaignAccess'
import { CampaignExporter } from '@/lib/export/campaign-exporter'
import { prisma } from '@/lib/prisma'
import { GET } from '../route'

const db = prisma as any

function req(query = '') {
  return new NextRequest(`http://localhost/api/campaigns/camp1/export${query}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(verifyAuth as any).mockResolvedValue({ userId: 'player1' })
  ;(getCampaignMembership as any).mockResolvedValue({ role: 'PLAYER' })
  ;(CampaignExporter.exportCampaign as any).mockResolvedValue({ some: 'data' })
  db.campaign.findUnique.mockResolvedValue({ title: 'My Campaign' })
})

describe('GET', () => {
  it('rejects an unauthenticated request', async () => {
    ;(verifyAuth as any).mockResolvedValue(null)
    const response = await GET(req(), { params: { id: 'camp1' } })
    expect(response.status).toBe(401)
  })

  it('rejects a non-member', async () => {
    ;(getCampaignMembership as any).mockResolvedValue(null)
    const response = await GET(req(), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
    expect(CampaignExporter.exportCampaign).not.toHaveBeenCalled()
  })

  it('includes every section by default', async () => {
    await GET(req(), { params: { id: 'camp1' } })
    expect(CampaignExporter.exportCampaign).toHaveBeenCalledWith('camp1', {
      includeCharacters: true,
      includeScenes: true,
      includeTimeline: true,
      includeMessages: true,
      includeNotes: true,
      includeNPCs: true,
      includeFactions: true,
      includeClocks: true,
      includeMoves: true,
      includeWorldMeta: true,
    })
  })

  it('turns off a section when its flag is false', async () => {
    await GET(req('?characters=false&notes=false'), { params: { id: 'camp1' } })
    expect(CampaignExporter.exportCampaign).toHaveBeenCalledWith('camp1', expect.objectContaining({
      includeCharacters: false,
      includeNotes: false,
      includeScenes: true,
    }))
  })

  it('returns a downloadable JSON attachment', async () => {
    const response = await GET(req(), { params: { id: 'camp1' } })
    expect(response.headers.get('Content-Type')).toBe('application/json')
    expect(response.headers.get('Content-Disposition')).toContain('attachment')
    expect(response.headers.get('Content-Disposition')).toContain('.json')
  })

  it('returns 500 on an unexpected error', async () => {
    ;(CampaignExporter.exportCampaign as any).mockRejectedValue(new Error('export failed'))
    const response = await GET(req(), { params: { id: 'camp1' } })
    expect(response.status).toBe(500)
  })
})
