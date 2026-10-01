// src/app/api/campaigns/__tests__/route.test.ts
// #135 (cont.) — the campaign list/create route had no test coverage:
// the auth gate, the required title, the loreImport branching validation
// (mirroring campaigns/[id]/lore/route.ts's own PASTE/URL/WIKI rules),
// and the unknown-templateId rejection, were all unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn() }))
vi.mock('@/lib/templates/campaign-templates', () => ({ getTemplate: vi.fn() }))
vi.mock('@/lib/analytics/events', () => ({ recordEvent: vi.fn() }))
// #493: the route enqueues now; the building happens in a worker.
vi.mock('@/lib/game/campaignCreationQueue', () => ({ enqueueCampaignCreation: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { campaignMembership: { findMany: vi.fn() } },
}))

import { requireAuth } from '@/lib/auth'
import { getTemplate } from '@/lib/templates/campaign-templates'
import { recordEvent } from '@/lib/analytics/events'
import { enqueueCampaignCreation } from '@/lib/game/campaignCreationQueue'
import { prisma } from '@/lib/prisma'
import { GET, POST } from '../route'

const db = prisma as any

function getRequest() {
  return new NextRequest('http://localhost/api/campaigns')
}

function postRequest(body: unknown) {
  return new NextRequest('http://localhost/api/campaigns', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(requireAuth as any).mockResolvedValue({ userId: 'u1' })
  db.campaignMembership.findMany.mockResolvedValue([])
  ;(enqueueCampaignCreation as any).mockResolvedValue({ jobId: 'job1' })
})

describe('GET', () => {
  it('rejects an unauthenticated request', async () => {
    ;(requireAuth as any).mockRejectedValue(new Error('Unauthorized'))
    const response = await GET(getRequest())
    expect(response.status).toBe(401)
  })

  it('returns campaigns with the caller\'s role attached', async () => {
    db.campaignMembership.findMany.mockResolvedValue([
      { role: 'ADMIN', campaign: { id: 'camp1', title: 'T' } },
    ])
    const response = await GET(getRequest())
    const body = await response.json()
    expect(body.campaigns).toEqual([{ id: 'camp1', title: 'T', userRole: 'ADMIN' }])
  })
})

describe('POST', () => {
  it('requires a title', async () => {
    const response = await POST(postRequest({}))
    expect(response.status).toBe(400)
    expect(enqueueCampaignCreation).not.toHaveBeenCalled()
  })

  it('rejects an unknown templateId', async () => {
    ;(getTemplate as any).mockReturnValue(null)
    const response = await POST(postRequest({ title: 'T', templateId: 'nonexistent' }))
    expect(response.status).toBe(400)
    expect(enqueueCampaignCreation).not.toHaveBeenCalled()
  })

  it('rejects an invalid loreImport.sourceType', async () => {
    const response = await POST(postRequest({ title: 'T', loreImport: { sourceType: 'PDF' } }))
    expect(response.status).toBe(400)
  })

  it('requires rawText for a PASTE loreImport', async () => {
    const response = await POST(postRequest({ title: 'T', loreImport: { sourceType: 'PASTE' } }))
    expect(response.status).toBe(400)
  })

  it('requires a valid sourceUrl for a URL loreImport', async () => {
    const response = await POST(postRequest({ title: 'T', loreImport: { sourceType: 'URL', sourceUrl: 'not-a-url' } }))
    expect(response.status).toBe(400)
  })

  // #493: creation is a job now. The route validates and hands off; it no
  // longer waits out five model calls and a seeding transaction.
  it('enqueues the creation and answers 202 with the job to follow', async () => {
    const response = await POST(postRequest({ title: 'New Campaign' }))
    const body = await response.json()

    // 202, not 201: nothing has been created yet, and a 201 carrying no
    // campaign would be a lie the client has to work around.
    expect(response.status).toBe(202)
    expect(body).toEqual({ jobId: 'job1' })
    expect(enqueueCampaignCreation).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ title: 'New Campaign' })
    )
  })

  it('records the funnel event at the point of intent', async () => {
    // Deliberately on enqueue rather than completion: a creation that dies
    // in the worker is exactly the drop-off this event needs to show.
    // Completion has its own evidence — the campaign row.
    await POST(postRequest({ title: 'New Campaign' }))
    expect(recordEvent).toHaveBeenCalledWith('CAMPAIGN_CREATED', { userId: 'u1' })
  })

  it('passes the template by id, not by value', async () => {
    // A template is code. Serialising one onto the job row would freeze a
    // copy that drifts from the definition the rest of the product uses.
    ;(getTemplate as any).mockReturnValue({ id: 'tpl1', universe: 'Grim', systemPrompt: 'p' })
    await POST(postRequest({ title: 'T', templateId: 'tpl1' }))

    expect(enqueueCampaignCreation).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ templateId: 'tpl1' })
    )
  })
})
