// src/app/api/campaigns/[id]/reports/__tests__/route.test.ts
// #135 (cont.) — content reporting (POST, any member) and the moderation
// queue (GET, GM-only) had no test coverage: the content-type/reason
// validation and the membership-vs-admin gate split were both unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({ getCampaignMembership: vi.fn(), requireCampaignAdmin: vi.fn() }))
vi.mock('@/lib/safety/safety-service', () => ({
  SafetyService: { reportContent: vi.fn(), getReports: vi.fn() },
}))

import { requireAuth } from '@/lib/auth'
import { getCampaignMembership, requireCampaignAdmin } from '@/lib/db/campaignAccess'
import { SafetyService } from '@/lib/safety/safety-service'
import { POST, GET } from '../route'

function postRequest(body: unknown) {
  return new NextRequest('http://localhost/api/campaigns/camp1/reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function getRequest(status?: string) {
  const url = status ? `http://localhost/api/campaigns/camp1/reports?status=${status}` : 'http://localhost/api/campaigns/camp1/reports'
  return new NextRequest(url)
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(requireAuth as any).mockResolvedValue({ userId: 'player1' })
  ;(getCampaignMembership as any).mockResolvedValue({ role: 'PLAYER' })
  ;(requireCampaignAdmin as any).mockResolvedValue({ membership: { role: 'ADMIN' } })
})

describe('POST', () => {
  it('rejects an unauthenticated request', async () => {
    ;(requireAuth as any).mockRejectedValue(new Error('Unauthorized'))
    const response = await POST(postRequest({ contentType: 'message', reason: 'rude' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(401)
  })

  it('rejects a non-member', async () => {
    ;(getCampaignMembership as any).mockResolvedValue(null)
    const response = await POST(postRequest({ contentType: 'message', reason: 'rude' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
    expect(SafetyService.reportContent).not.toHaveBeenCalled()
  })

  it('rejects an invalid content type', async () => {
    const response = await POST(postRequest({ contentType: 'not-a-real-type', reason: 'rude' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(400)
    expect(SafetyService.reportContent).not.toHaveBeenCalled()
  })

  it('rejects a blank reason', async () => {
    const response = await POST(postRequest({ contentType: 'message', reason: '   ' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(400)
    expect(SafetyService.reportContent).not.toHaveBeenCalled()
  })

  it('submits the report', async () => {
    ;(SafetyService.reportContent as any).mockResolvedValue({ id: 'report1' })
    const response = await POST(
      postRequest({ contentType: 'message', contentId: 'msg1', reason: 'harassment', category: 'harassment', contentText: 'the message' }),
      { params: { id: 'camp1' } }
    )
    expect(response.status).toBe(200)
    expect(SafetyService.reportContent).toHaveBeenCalledWith(
      'player1', 'camp1', 'message', 'msg1', 'harassment', 'harassment', 'MEDIUM', 'the message'
    )
  })
})

describe('GET', () => {
  it('rejects a non-admin', async () => {
    ;(requireCampaignAdmin as any).mockResolvedValue({ response: new Response(null, { status: 403 }) })
    const response = await GET(getRequest(), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
    expect(SafetyService.getReports).not.toHaveBeenCalled()
  })

  it('lists reports for an admin, unfiltered by default', async () => {
    ;(SafetyService.getReports as any).mockResolvedValue([{ id: 'report1' }])
    const response = await GET(getRequest(), { params: { id: 'camp1' } })
    expect(response.status).toBe(200)
    expect(SafetyService.getReports).toHaveBeenCalledWith('camp1', undefined)
  })

  it('filters by a valid status', async () => {
    ;(SafetyService.getReports as any).mockResolvedValue([])
    await GET(getRequest('PENDING'), { params: { id: 'camp1' } })
    expect(SafetyService.getReports).toHaveBeenCalledWith('camp1', 'PENDING')
  })

  it('ignores an invalid status filter rather than erroring', async () => {
    ;(SafetyService.getReports as any).mockResolvedValue([])
    await GET(getRequest('not-a-real-status'), { params: { id: 'camp1' } })
    expect(SafetyService.getReports).toHaveBeenCalledWith('camp1', undefined)
  })
})
