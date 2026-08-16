// src/app/api/campaigns/[id]/reseed-from-lore/__tests__/route.test.ts
// #135 (cont.) — the manual world-reseed trigger had no test coverage:
// the admin-only gate on both verbs, the rate limit, the "no imported
// lore yet" synchronous pre-check that gives an immediate specific error
// instead of creating a job doomed to fail, and that GET recovers stale
// jobs before polling, were all unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ getUser: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({ getCampaignMembership: vi.fn() }))
vi.mock('@/lib/rateLimit', () => ({
  AI_ACTION_LIMIT: { bucket: 'ai-action', limit: 20, windowSeconds: 60 },
  checkRateLimit: vi.fn(),
  rateLimitExceededResponse: vi.fn(),
}))
vi.mock('@/lib/lore/reseedQueue', () => ({
  kickReseedJob: vi.fn(),
  recoverStaleReseedJobs: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    reseedJob: { findFirst: vi.fn(), create: vi.fn() },
    loreEntry: { findFirst: vi.fn() },
  },
}))

import { getUser } from '@/lib/auth'
import { getCampaignMembership } from '@/lib/db/campaignAccess'
import { checkRateLimit, rateLimitExceededResponse } from '@/lib/rateLimit'
import { kickReseedJob, recoverStaleReseedJobs } from '@/lib/lore/reseedQueue'
import { prisma } from '@/lib/prisma'
import { GET, POST } from '../route'

const db = prisma as any

function getRequest() {
  return new NextRequest('http://localhost/api/campaigns/camp1/reseed-from-lore')
}

function postRequest(body: unknown = {}) {
  return new NextRequest('http://localhost/api/campaigns/camp1/reseed-from-lore', {
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
  db.loreEntry.findFirst.mockResolvedValue({ id: 'entry1' })
  db.reseedJob.create.mockResolvedValue({ id: 'job1' })
})

describe('GET', () => {
  it('rejects a non-admin', async () => {
    ;(getCampaignMembership as any).mockResolvedValue({ role: 'PLAYER' })
    const response = await GET(getRequest(), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
  })

  it('recovers stale jobs before polling', async () => {
    await GET(getRequest(), { params: { id: 'camp1' } })
    expect(recoverStaleReseedJobs).toHaveBeenCalledWith('camp1')
  })
})

describe('POST', () => {
  it('rejects a non-admin', async () => {
    ;(getCampaignMembership as any).mockResolvedValue({ role: 'PLAYER' })
    const response = await POST(postRequest(), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
  })

  it('is rate limited', async () => {
    ;(checkRateLimit as any).mockResolvedValue({ allowed: false })
    ;(rateLimitExceededResponse as any).mockReturnValue(new Response(null, { status: 429 }))
    const response = await POST(postRequest(), { params: { id: 'camp1' } })
    expect(response.status).toBe(429)
  })

  it('gives an immediate error when there is no imported lore yet, without creating a job', async () => {
    db.loreEntry.findFirst.mockResolvedValue(null)
    const response = await POST(postRequest(), { params: { id: 'camp1' } })
    expect(response.status).toBe(400)
    expect(db.reseedJob.create).not.toHaveBeenCalled()
  })

  it('creates the job and kicks the worker', async () => {
    const response = await POST(postRequest({ forceStatLabels: true }), { params: { id: 'camp1' } })
    const body = await response.json()
    expect(response.status).toBe(202)
    expect(body.job).toEqual({ id: 'job1' })
    expect(db.reseedJob.create).toHaveBeenCalledWith({ data: { campaignId: 'camp1', forceStatLabels: true } })
    expect(kickReseedJob).toHaveBeenCalledWith('job1')
  })

  it('tolerates a missing/malformed body, defaulting forceStatLabels to false', async () => {
    const request = new NextRequest('http://localhost/api/campaigns/camp1/reseed-from-lore', { method: 'POST' })
    await POST(request, { params: { id: 'camp1' } })
    expect(db.reseedJob.create).toHaveBeenCalledWith({ data: { campaignId: 'camp1', forceStatLabels: false } })
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
