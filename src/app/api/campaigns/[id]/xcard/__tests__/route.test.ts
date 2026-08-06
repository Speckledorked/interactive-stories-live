// src/app/api/campaigns/[id]/xcard/__tests__/route.test.ts
// #135 (cont.) — the X-Card (POST, any member can use it) and its history
// (GET, GM-only) had no test coverage: the invalid-trigger validation and
// the membership-vs-admin gate split were both unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ verifyAuth: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({ getCampaignMembership: vi.fn(), requireCampaignAdmin: vi.fn() }))
vi.mock('@/lib/safety/safety-service', () => ({
  SafetyService: { useXCard: vi.fn(), getXCardHistory: vi.fn() },
}))

import { verifyAuth } from '@/lib/auth'
import { getCampaignMembership, requireCampaignAdmin } from '@/lib/db/campaignAccess'
import { SafetyService } from '@/lib/safety/safety-service'
import { POST, GET } from '../route'

function postRequest(body: unknown) {
  return new NextRequest('http://localhost/api/campaigns/camp1/xcard', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function getRequest() {
  return new NextRequest('http://localhost/api/campaigns/camp1/xcard')
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(verifyAuth as any).mockResolvedValue({ userId: 'player1' })
  ;(getCampaignMembership as any).mockResolvedValue({ role: 'PLAYER' })
  ;(requireCampaignAdmin as any).mockResolvedValue({ membership: { role: 'ADMIN' } })
})

describe('POST', () => {
  it('rejects an unauthenticated request', async () => {
    ;(verifyAuth as any).mockResolvedValue(null)
    const response = await POST(postRequest({ trigger: 'GENERAL' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(401)
  })

  it('rejects a non-member', async () => {
    ;(getCampaignMembership as any).mockResolvedValue(null)
    const response = await POST(postRequest({ trigger: 'GENERAL' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
    expect(SafetyService.useXCard).not.toHaveBeenCalled()
  })

  it('rejects an invalid trigger', async () => {
    const response = await POST(postRequest({ trigger: 'NOT_A_REAL_TRIGGER' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(400)
    expect(SafetyService.useXCard).not.toHaveBeenCalled()
  })

  it('lets any member use the X-Card', async () => {
    ;(SafetyService.useXCard as any).mockResolvedValue({ id: 'use1', trigger: 'VIOLENCE' })
    const response = await POST(postRequest({ trigger: 'VIOLENCE', reason: 'too much' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(200)
    expect(SafetyService.useXCard).toHaveBeenCalledWith('camp1', 'player1', 'VIOLENCE', undefined, 'too much', undefined)
  })

  it('returns 500 on an unexpected error', async () => {
    ;(SafetyService.useXCard as any).mockRejectedValue(new Error('db down'))
    const response = await POST(postRequest({ trigger: 'GENERAL' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(500)
  })
})

describe('GET', () => {
  it('rejects an unauthenticated request', async () => {
    ;(verifyAuth as any).mockResolvedValue(null)
    const response = await GET(getRequest(), { params: { id: 'camp1' } })
    expect(response.status).toBe(401)
  })

  it('rejects a non-admin (GM only)', async () => {
    ;(requireCampaignAdmin as any).mockResolvedValue({ response: new Response(null, { status: 403 }) })
    const response = await GET(getRequest(), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
    expect(SafetyService.getXCardHistory).not.toHaveBeenCalled()
  })

  it('returns the X-Card history for an admin', async () => {
    ;(SafetyService.getXCardHistory as any).mockResolvedValue([{ id: 'use1' }])
    const response = await GET(getRequest(), { params: { id: 'camp1' } })
    expect(response.status).toBe(200)
    expect(SafetyService.getXCardHistory).toHaveBeenCalledWith('camp1', true)
  })
})
