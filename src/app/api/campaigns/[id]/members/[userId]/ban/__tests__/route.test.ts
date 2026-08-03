// src/app/api/campaigns/[id]/members/[userId]/ban/__tests__/route.test.ts
// #93 — this route was entirely untested despite being the app's real
// moderation lever: a wrong guard here means either a disruptive player
// can't be removed, or a GM can be banned/self-banned by mistake.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({
  requireCampaignAdmin: vi.fn(),
  getCampaignMembership: vi.fn(),
}))
vi.mock('@/lib/safety/safety-service', () => ({
  SafetyService: {
    banUserFromCampaign: vi.fn(),
    unbanUserFromCampaign: vi.fn(),
  },
}))

import { requireAuth } from '@/lib/auth'
import { requireCampaignAdmin, getCampaignMembership } from '@/lib/db/campaignAccess'
import { SafetyService } from '@/lib/safety/safety-service'
import { POST, DELETE } from '../route'

function postRequest(body: unknown) {
  return new NextRequest('http://localhost/api/campaigns/camp1/members/user2/ban', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function deleteRequest() {
  return new NextRequest('http://localhost/api/campaigns/camp1/members/user2/ban', { method: 'DELETE' })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(requireAuth as any).mockResolvedValue({ userId: 'admin1', email: 'admin@example.com' })
  ;(requireCampaignAdmin as any).mockResolvedValue({ membership: { role: 'ADMIN' } })
})

describe('POST (ban)', () => {
  it('refuses to let an admin ban themselves', async () => {
    const response = await POST(postRequest({ reason: 'trolling' }), { params: { id: 'camp1', userId: 'admin1' } })
    expect(response.status).toBe(400)
    expect(SafetyService.banUserFromCampaign).not.toHaveBeenCalled()
  })

  it('rejects a non-admin', async () => {
    ;(requireCampaignAdmin as any).mockResolvedValue({ response: new Response(null, { status: 403 }) })
    const response = await POST(postRequest({ reason: 'trolling' }), { params: { id: 'camp1', userId: 'user2' } })
    expect(response.status).toBe(403)
    expect(SafetyService.banUserFromCampaign).not.toHaveBeenCalled()
  })

  it('404s (403) when the target is not actually a member', async () => {
    ;(getCampaignMembership as any).mockResolvedValue(null)
    const response = await POST(postRequest({ reason: 'trolling' }), { params: { id: 'camp1', userId: 'user2' } })
    expect(response.status).toBe(403)
    expect(SafetyService.banUserFromCampaign).not.toHaveBeenCalled()
  })

  it('refuses to ban another admin before they are demoted', async () => {
    ;(getCampaignMembership as any).mockResolvedValue({ role: 'ADMIN' })
    const response = await POST(postRequest({ reason: 'trolling' }), { params: { id: 'camp1', userId: 'user2' } })
    expect(response.status).toBe(400)
    expect(SafetyService.banUserFromCampaign).not.toHaveBeenCalled()
  })

  it('requires a non-empty reason', async () => {
    ;(getCampaignMembership as any).mockResolvedValue({ role: 'PLAYER' })
    const response = await POST(postRequest({ reason: '   ' }), { params: { id: 'camp1', userId: 'user2' } })
    expect(response.status).toBe(400)
    expect(SafetyService.banUserFromCampaign).not.toHaveBeenCalled()
  })

  it('bans a player with a trimmed reason, defaulting isPermanent to false', async () => {
    ;(getCampaignMembership as any).mockResolvedValue({ role: 'PLAYER' })
    ;(SafetyService.banUserFromCampaign as any).mockResolvedValue({ id: 'ban1' })

    const response = await POST(postRequest({ reason: '  disruptive  ' }), { params: { id: 'camp1', userId: 'user2' } })

    expect(response.status).toBe(200)
    expect(SafetyService.banUserFromCampaign).toHaveBeenCalledWith('camp1', 'user2', 'admin1', 'disruptive', false, undefined)
  })

  it('passes through isPermanent and expiresAt when provided', async () => {
    ;(getCampaignMembership as any).mockResolvedValue({ role: 'PLAYER' })
    ;(SafetyService.banUserFromCampaign as any).mockResolvedValue({ id: 'ban1' })

    await POST(postRequest({ reason: 'repeated harassment', isPermanent: true, expiresAt: '2027-01-01T00:00:00.000Z' }), {
      params: { id: 'camp1', userId: 'user2' },
    })

    const call = (SafetyService.banUserFromCampaign as any).mock.calls[0]
    expect(call[4]).toBe(true)
    expect(call[5]).toEqual(new Date('2027-01-01T00:00:00.000Z'))
  })
})

describe('DELETE (unban)', () => {
  it('rejects a non-admin', async () => {
    ;(requireCampaignAdmin as any).mockResolvedValue({ response: new Response(null, { status: 403 }) })
    const response = await DELETE(deleteRequest(), { params: { id: 'camp1', userId: 'user2' } })
    expect(response.status).toBe(403)
    expect(SafetyService.unbanUserFromCampaign).not.toHaveBeenCalled()
  })

  it('unbans the target user', async () => {
    const response = await DELETE(deleteRequest(), { params: { id: 'camp1', userId: 'user2' } })
    expect(response.status).toBe(200)
    expect(SafetyService.unbanUserFromCampaign).toHaveBeenCalledWith('camp1', 'user2')
  })
})
