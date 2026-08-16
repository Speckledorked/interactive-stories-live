// src/app/api/campaigns/[id]/safety-settings/__tests__/route.test.ts
// Previously there was no route at all for CampaignSafetySettings — every
// campaign silently ran on hardcoded defaults, invisible to the GM.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaignMembership: { findUnique: vi.fn() },
  },
}))
vi.mock('@/lib/auth', () => ({
  getUser: vi.fn(),
}))
vi.mock('@/lib/safety/safety-service', () => ({
  SafetyService: {
    getCampaignSafety: vi.fn(),
    updateSafetySettings: vi.fn(),
  },
}))

import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { SafetyService } from '@/lib/safety/safety-service'
import { GET, PATCH } from '../route'

const db = prisma as any

function getRequest() {
  return new NextRequest('http://localhost/api/campaigns/camp1/safety-settings')
}

function patchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/campaigns/camp1/safety-settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getUser as any).mockResolvedValue({ userId: 'user1', email: 'user1@example.com' })
})

describe('GET', () => {
  it('rejects a non-member', async () => {
    db.campaignMembership.findUnique.mockResolvedValue(null)
    const response = await GET(getRequest(), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
  })

  it('returns settings for any member, not just admins', async () => {
    db.campaignMembership.findUnique.mockResolvedValue({ role: 'PLAYER' })
    ;(SafetyService.getCampaignSafety as any).mockResolvedValue({ xCardEnabled: true, lines: [] })

    const response = await GET(getRequest(), { params: { id: 'camp1' } })

    expect(response.status).toBe(200)
    expect(SafetyService.getCampaignSafety).toHaveBeenCalledWith('camp1')
  })
})

describe('PATCH', () => {
  it('rejects a non-admin', async () => {
    db.campaignMembership.findUnique.mockResolvedValue({ role: 'PLAYER' })
    const response = await PATCH(patchRequest({ pauseOnXCard: false }), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
    expect(SafetyService.updateSafetySettings).not.toHaveBeenCalled()
  })

  it('lets an admin update lines and veils', async () => {
    db.campaignMembership.findUnique.mockResolvedValue({ role: 'ADMIN' })
    ;(SafetyService.updateSafetySettings as any).mockResolvedValue({ lines: ['a'], veils: ['b'] })

    const response = await PATCH(
      patchRequest({ lines: ['a'], veils: ['b'], xCardEnabled: true }),
      { params: { id: 'camp1' } }
    )

    expect(response.status).toBe(200)
    expect(SafetyService.updateSafetySettings).toHaveBeenCalledWith('camp1', {
      xCardEnabled: true,
      anonymousXCard: undefined,
      pauseOnXCard: undefined,
      xCardNotifyGMOnly: undefined,
      lines: ['a'],
      veils: ['b'],
    })
  })

  it('ignores non-string entries in lines/veils rather than persisting garbage', async () => {
    db.campaignMembership.findUnique.mockResolvedValue({ role: 'ADMIN' })
    ;(SafetyService.updateSafetySettings as any).mockResolvedValue({})

    await PATCH(patchRequest({ lines: ['ok', 42, null] }), { params: { id: 'camp1' } })

    expect(SafetyService.updateSafetySettings).toHaveBeenCalledWith(
      'camp1',
      expect.objectContaining({ lines: ['ok'] })
    )
  })
})

// #426, found by mutation audit: flipping this route's `status: 401` to
// `status: 200` did not fail a single test, because no test ever set
// getUser to null. The unauthenticated branch — the most basic guarantee
// the route makes — was never executed. Every other assertion in this file
// runs as a signed-in user, so the 401 was structurally unreachable by the
// suite that was said to cover it.
describe('unauthenticated access (#426)', () => {
  it('rejects a caller with no session', async () => {
    ;(getUser as any).mockResolvedValue(null)

    const response = await GET(getRequest(), { params: { id: 'camp1' } })

    expect(response.status).toBe(401)
  })
})
