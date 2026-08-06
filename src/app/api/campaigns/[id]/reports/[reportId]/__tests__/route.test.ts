// src/app/api/campaigns/[id]/reports/[reportId]/__tests__/route.test.ts
// #135 (cont.) — GM resolution of a queued report had no test coverage:
// the campaign-scoping check on the report lookup (a report belonging to
// a DIFFERENT campaign must 404, not just any nonexistent id), and the
// resolve-vs-dismiss action split, were both unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({ requireCampaignAdmin: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { contentReport: { findUnique: vi.fn() } },
}))
vi.mock('@/lib/safety/safety-service', () => ({
  SafetyService: { resolveReport: vi.fn(), dismissReport: vi.fn() },
}))

import { requireAuth } from '@/lib/auth'
import { requireCampaignAdmin } from '@/lib/db/campaignAccess'
import { prisma } from '@/lib/prisma'
import { SafetyService } from '@/lib/safety/safety-service'
import { PATCH } from '../route'

const db = prisma as any

function req(body: unknown) {
  return new NextRequest('http://localhost/api/campaigns/camp1/reports/report1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(requireAuth as any).mockResolvedValue({ userId: 'admin1' })
  ;(requireCampaignAdmin as any).mockResolvedValue({ membership: { role: 'ADMIN' } })
})

describe('PATCH', () => {
  it('rejects a non-admin', async () => {
    ;(requireCampaignAdmin as any).mockResolvedValue({ response: new Response(null, { status: 403 }) })
    const response = await PATCH(req({ action: 'resolve', resolution: 'handled' }), { params: { id: 'camp1', reportId: 'report1' } })
    expect(response.status).toBe(403)
    expect(db.contentReport.findUnique).not.toHaveBeenCalled()
  })

  it('404s when the report does not exist', async () => {
    db.contentReport.findUnique.mockResolvedValue(null)
    const response = await PATCH(req({ action: 'resolve', resolution: 'handled' }), { params: { id: 'camp1', reportId: 'report1' } })
    expect(response.status).toBe(404)
  })

  it('404s when the report belongs to a different campaign', async () => {
    db.contentReport.findUnique.mockResolvedValue({ id: 'report1', campaignId: 'other-camp' })
    const response = await PATCH(req({ action: 'resolve', resolution: 'handled' }), { params: { id: 'camp1', reportId: 'report1' } })
    expect(response.status).toBe(404)
    expect(SafetyService.resolveReport).not.toHaveBeenCalled()
  })

  it('rejects resolving without a resolution note', async () => {
    db.contentReport.findUnique.mockResolvedValue({ id: 'report1', campaignId: 'camp1' })
    const response = await PATCH(req({ action: 'resolve', resolution: '  ' }), { params: { id: 'camp1', reportId: 'report1' } })
    expect(response.status).toBe(400)
    expect(SafetyService.resolveReport).not.toHaveBeenCalled()
  })

  it('resolves the report', async () => {
    db.contentReport.findUnique.mockResolvedValue({ id: 'report1', campaignId: 'camp1' })
    ;(SafetyService.resolveReport as any).mockResolvedValue({ id: 'report1', status: 'RESOLVED' })

    const response = await PATCH(req({ action: 'resolve', resolution: 'Warned the player.', actionTaken: 'warning' }), { params: { id: 'camp1', reportId: 'report1' } })

    expect(response.status).toBe(200)
    expect(SafetyService.resolveReport).toHaveBeenCalledWith('report1', 'admin1', 'Warned the player.', 'warning')
  })

  it('dismisses the report without requiring a resolution note', async () => {
    db.contentReport.findUnique.mockResolvedValue({ id: 'report1', campaignId: 'camp1' })
    ;(SafetyService.dismissReport as any).mockResolvedValue({ id: 'report1', status: 'DISMISSED' })

    const response = await PATCH(req({ action: 'dismiss' }), { params: { id: 'camp1', reportId: 'report1' } })

    expect(response.status).toBe(200)
    expect(SafetyService.dismissReport).toHaveBeenCalledWith('report1', 'admin1', 'Dismissed')
  })

  it('rejects an unrecognized action', async () => {
    db.contentReport.findUnique.mockResolvedValue({ id: 'report1', campaignId: 'camp1' })
    const response = await PATCH(req({ action: 'delete' }), { params: { id: 'camp1', reportId: 'report1' } })
    expect(response.status).toBe(400)
  })
})
