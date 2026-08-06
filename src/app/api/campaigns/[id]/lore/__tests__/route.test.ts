// src/app/api/campaigns/[id]/lore/__tests__/route.test.ts
// #135 (cont.) — lore import had no test coverage: the admin-only gate,
// the rate limit, the PASTE-vs-URL-vs-WIKI branching validation (each
// requiring a different field, a paste length cap, and a real URL for
// the other two), and that excludeCategories is only honored for WIKI,
// were all unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ getUser: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({ getCampaignMembership: vi.fn() }))
vi.mock('@/lib/rateLimit', () => ({
  LORE_IMPORT_LIMIT: { bucket: 'lore-import', limit: 5, windowSeconds: 3600 },
  checkRateLimit: vi.fn(),
  rateLimitExceededResponse: vi.fn(),
}))
vi.mock('@/lib/lore/loreQueue', () => ({
  kickLoreImportJob: vi.fn(),
  recoverStaleLoreJobs: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: { loreImportJob: { findMany: vi.fn(), create: vi.fn() } },
}))

import { getUser } from '@/lib/auth'
import { getCampaignMembership } from '@/lib/db/campaignAccess'
import { checkRateLimit, rateLimitExceededResponse } from '@/lib/rateLimit'
import { kickLoreImportJob, recoverStaleLoreJobs } from '@/lib/lore/loreQueue'
import { prisma } from '@/lib/prisma'
import { GET, POST } from '../route'

const db = prisma as any

function getRequest() {
  return new NextRequest('http://localhost/api/campaigns/camp1/lore')
}

function postRequest(body: unknown) {
  return new NextRequest('http://localhost/api/campaigns/camp1/lore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getUser as any).mockResolvedValue({ userId: 'admin1' })
  ;(getCampaignMembership as any).mockResolvedValue({ role: 'ADMIN' })
  ;(checkRateLimit as any).mockResolvedValue({ allowed: true })
  db.loreImportJob.findMany.mockResolvedValue([])
  db.loreImportJob.create.mockResolvedValue({ id: 'job1' })
})

describe('GET', () => {
  it('rejects an unauthenticated request', async () => {
    ;(getUser as any).mockResolvedValue(null)
    const response = await GET(getRequest(), { params: { id: 'camp1' } })
    expect(response.status).toBe(401)
  })

  it('rejects a non-admin', async () => {
    ;(getCampaignMembership as any).mockResolvedValue({ role: 'PLAYER' })
    const response = await GET(getRequest(), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
  })

  it('recovers stale jobs before listing', async () => {
    await GET(getRequest(), { params: { id: 'camp1' } })
    expect(recoverStaleLoreJobs).toHaveBeenCalledWith('camp1')
  })
})

describe('POST', () => {
  it('rejects a non-admin', async () => {
    ;(getCampaignMembership as any).mockResolvedValue({ role: 'PLAYER' })
    const response = await POST(postRequest({ sourceType: 'PASTE', rawText: 'x' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
  })

  it('is rate limited', async () => {
    ;(checkRateLimit as any).mockResolvedValue({ allowed: false })
    ;(rateLimitExceededResponse as any).mockReturnValue(new Response(null, { status: 429 }))
    const response = await POST(postRequest({ sourceType: 'PASTE', rawText: 'x' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(429)
  })

  it('rejects an invalid sourceType', async () => {
    const response = await POST(postRequest({ sourceType: 'PDF' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(400)
  })

  it('requires rawText for PASTE', async () => {
    const response = await POST(postRequest({ sourceType: 'PASTE' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(400)
  })

  it('rejects a paste over the length cap', async () => {
    const response = await POST(postRequest({ sourceType: 'PASTE', rawText: 'x'.repeat(200_001) }), { params: { id: 'camp1' } })
    expect(response.status).toBe(400)
  })

  it('requires a valid URL for URL/WIKI sources', async () => {
    const response = await POST(postRequest({ sourceType: 'URL', sourceUrl: 'not-a-url' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(400)
  })

  it('ignores excludeCategories for a non-WIKI source', async () => {
    await POST(postRequest({ sourceType: 'URL', sourceUrl: 'https://example.com', excludeCategories: ['Characters'] }), { params: { id: 'camp1' } })
    expect(db.loreImportJob.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ excludeCategories: [] }),
    }))
  })

  it('honors excludeCategories for a WIKI source', async () => {
    await POST(postRequest({ sourceType: 'WIKI', sourceUrl: 'https://example.com/wiki', excludeCategories: ['Characters', 42, '  Locations  '] }), { params: { id: 'camp1' } })
    expect(db.loreImportJob.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ excludeCategories: ['Characters', 'Locations'] }),
    }))
  })

  it('creates the job and kicks the worker', async () => {
    const response = await POST(postRequest({ sourceType: 'PASTE', rawText: 'lore text' }), { params: { id: 'camp1' } })
    const body = await response.json()
    expect(response.status).toBe(201)
    expect(body.job).toEqual({ id: 'job1' })
    expect(kickLoreImportJob).toHaveBeenCalledWith('job1')
  })
})
