// src/app/api/internal/generate-campaign-hero-image/__tests__/route.test.ts
// #135 (cont.) — the campaign hero-image worker route had no test
// coverage: the shared internal-secret gate, and the required campaignId
// body field (including a malformed/non-JSON body, which must fail
// validation rather than throw), were both unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/game/campaignHeroImage', () => ({ generateCampaignHeroImage: vi.fn() }))
vi.mock('@/lib/game/resolutionQueue', () => ({ internalJobSecret: vi.fn(() => 'internal-secret') }))

import { generateCampaignHeroImage } from '@/lib/game/campaignHeroImage'
import { POST } from '../route'

function req(body: unknown, secret = 'internal-secret') {
  return new NextRequest('http://localhost/api/internal/generate-campaign-hero-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-secret': secret },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(generateCampaignHeroImage as any).mockResolvedValue(undefined)
})

describe('POST', () => {
  it('rejects a missing secret', async () => {
    const request = new NextRequest('http://localhost/api/internal/generate-campaign-hero-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaignId: 'camp1' }),
    })
    const response = await POST(request)
    expect(response.status).toBe(403)
    expect(generateCampaignHeroImage).not.toHaveBeenCalled()
  })

  it('rejects the wrong secret', async () => {
    const response = await POST(req({ campaignId: 'camp1' }, 'wrong-secret'))
    expect(response.status).toBe(403)
  })

  it('requires campaignId', async () => {
    const response = await POST(req({}))
    expect(response.status).toBe(400)
    expect(generateCampaignHeroImage).not.toHaveBeenCalled()
  })

  it('validates cleanly against a malformed JSON body instead of throwing', async () => {
    const request = new NextRequest('http://localhost/api/internal/generate-campaign-hero-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': 'internal-secret' },
      body: 'not json',
    })
    const response = await POST(request)
    expect(response.status).toBe(400)
  })

  it('generates the hero image for a valid request', async () => {
    const response = await POST(req({ campaignId: 'camp1' }))
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body).toEqual({ status: 'done' })
    expect(generateCampaignHeroImage).toHaveBeenCalledWith('camp1')
  })
})
