// src/app/api/campaigns/[id]/settings/ai/__tests__/route.test.ts
// #135 (cont.) — updating a campaign's AI settings had no test coverage:
// the admin gate, and normalizing contentModerationLevel to only ever
// 'strict' or 'standard' regardless of what the client sends, were both
// unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ getUser: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({ requireCampaignAdmin: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { campaign: { update: vi.fn() } },
}))

import { getUser } from '@/lib/auth'
import { requireCampaignAdmin } from '@/lib/db/campaignAccess'
import { prisma } from '@/lib/prisma'
import { PATCH } from '../route'

const db = prisma as any

function req(body: unknown) {
  return new NextRequest('http://localhost/api/campaigns/camp1/settings/ai', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getUser as any).mockResolvedValue({ userId: 'admin1' })
  ;(requireCampaignAdmin as any).mockResolvedValue({ membership: { role: 'ADMIN' } })
})

describe('PATCH', () => {
  it('rejects an unauthenticated request', async () => {
    ;(getUser as any).mockResolvedValue(null)
    const response = await PATCH(req({}), { params: { id: 'camp1' } })
    expect(response.status).toBe(401)
    expect(db.campaign.update).not.toHaveBeenCalled()
  })

  it('rejects a non-admin', async () => {
    ;(requireCampaignAdmin as any).mockResolvedValue({ response: new Response(null, { status: 403 }) })
    const response = await PATCH(req({}), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
    expect(db.campaign.update).not.toHaveBeenCalled()
  })

  it('sets contentModerationLevel to strict when explicitly requested', async () => {
    db.campaign.update.mockResolvedValue({ id: 'camp1', contentModerationLevel: 'strict' })
    await PATCH(req({ contentModerationLevel: 'strict' }), { params: { id: 'camp1' } })
    expect(db.campaign.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ contentModerationLevel: 'strict' }),
    }))
  })

  it('normalizes any non-"strict" value to standard', async () => {
    db.campaign.update.mockResolvedValue({ id: 'camp1', contentModerationLevel: 'standard' })
    await PATCH(req({ contentModerationLevel: 'whatever-the-client-sent' }), { params: { id: 'camp1' } })
    expect(db.campaign.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ contentModerationLevel: 'standard' }),
    }))
  })

  it('returns the updated campaign settings', async () => {
    db.campaign.update.mockResolvedValue({ id: 'camp1', aiSystemPrompt: 'Be a good GM', initialWorldSeed: 'seed text', contentModerationLevel: 'standard' })
    const response = await PATCH(req({ aiSystemPrompt: 'Be a good GM', initialWorldSeed: 'seed text' }), { params: { id: 'camp1' } })
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.campaign).toEqual({ id: 'camp1', aiSystemPrompt: 'Be a good GM', initialWorldSeed: 'seed text', contentModerationLevel: 'standard' })
  })

  it('returns 500 on an unexpected error', async () => {
    db.campaign.update.mockRejectedValue(new Error('db down'))
    const response = await PATCH(req({}), { params: { id: 'camp1' } })
    expect(response.status).toBe(500)
  })
})
