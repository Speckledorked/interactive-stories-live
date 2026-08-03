// src/app/api/campaigns/[id]/hero-image/__tests__/route.test.ts
// Admin-only manual backfill for campaigns created before the hero-image
// feature shipped (or whose generation failed) — see route.ts's header
// comment.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ getUser: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({ requireCampaignAdmin: vi.fn() }))
vi.mock('@/lib/game/campaignHeroImage', () => ({ kickCampaignHeroImage: vi.fn() }))

import { getUser } from '@/lib/auth'
import { requireCampaignAdmin } from '@/lib/db/campaignAccess'
import { kickCampaignHeroImage } from '@/lib/game/campaignHeroImage'
import { POST } from '../route'

function req() {
  return new NextRequest('http://localhost/api/campaigns/camp1/hero-image', { method: 'POST' })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getUser as any).mockResolvedValue({ userId: 'admin1', email: 'admin@example.com' })
  ;(requireCampaignAdmin as any).mockResolvedValue({ membership: { role: 'ADMIN' } })
  ;(kickCampaignHeroImage as any).mockResolvedValue(undefined)
})

describe('POST /api/campaigns/[id]/hero-image', () => {
  it('rejects an unauthenticated request', async () => {
    ;(getUser as any).mockResolvedValue(null)
    const response = await POST(req(), { params: { id: 'camp1' } })
    expect(response.status).toBe(401)
    expect(kickCampaignHeroImage).not.toHaveBeenCalled()
  })

  it('rejects a non-admin', async () => {
    ;(requireCampaignAdmin as any).mockResolvedValue({ response: new Response(null, { status: 403 }) })
    const response = await POST(req(), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
    expect(kickCampaignHeroImage).not.toHaveBeenCalled()
  })

  it('kicks hero image generation for an admin and returns 202', async () => {
    const response = await POST(req(), { params: { id: 'camp1' } })
    const body = await response.json()

    expect(response.status).toBe(202)
    expect(body.status).toBe('PENDING')
    expect(kickCampaignHeroImage).toHaveBeenCalledWith('camp1')
  })

  it('still returns 202 even if the kick rejects asynchronously', async () => {
    ;(kickCampaignHeroImage as any).mockRejectedValue(new Error('internal worker unreachable'))
    const response = await POST(req(), { params: { id: 'camp1' } })
    expect(response.status).toBe(202)
  })
})
