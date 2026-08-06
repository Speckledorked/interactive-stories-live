// src/app/api/campaigns/[id]/lore/jobs/[jobId]/__tests__/route.test.ts
// #135 (cont.) — polling a single lore import job had no test coverage:
// the admin-only gate, and that a jobId from a DIFFERENT campaign 404s
// rather than leaking another campaign's job status, were both
// unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ getUser: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({ requireCampaignAdmin: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { loreImportJob: { findFirst: vi.fn() } },
}))

import { getUser } from '@/lib/auth'
import { requireCampaignAdmin } from '@/lib/db/campaignAccess'
import { prisma } from '@/lib/prisma'
import { GET } from '../route'

const db = prisma as any

function req() {
  return new NextRequest('http://localhost/api/campaigns/camp1/lore/jobs/job1')
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getUser as any).mockResolvedValue({ userId: 'admin1' })
  ;(requireCampaignAdmin as any).mockResolvedValue({ membership: { role: 'ADMIN' } })
})

describe('GET', () => {
  it('rejects an unauthenticated request', async () => {
    ;(getUser as any).mockResolvedValue(null)
    const response = await GET(req(), { params: { id: 'camp1', jobId: 'job1' } })
    expect(response.status).toBe(401)
  })

  it('rejects a non-admin', async () => {
    ;(requireCampaignAdmin as any).mockResolvedValue({ response: new Response(null, { status: 403 }) })
    const response = await GET(req(), { params: { id: 'camp1', jobId: 'job1' } })
    expect(response.status).toBe(403)
  })

  it('scopes the lookup to id AND campaignId, 404ing for a cross-campaign job', async () => {
    db.loreImportJob.findFirst.mockResolvedValue(null)
    const response = await GET(req(), { params: { id: 'camp1', jobId: 'job1' } })
    expect(response.status).toBe(404)
    expect(db.loreImportJob.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'job1', campaignId: 'camp1' },
    }))
  })

  it('returns the job for a member campaign match', async () => {
    db.loreImportJob.findFirst.mockResolvedValue({ id: 'job1', status: 'RUNNING' })
    const response = await GET(req(), { params: { id: 'camp1', jobId: 'job1' } })
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.job).toEqual({ id: 'job1', status: 'RUNNING' })
  })

  it('returns 500 on an unexpected error', async () => {
    db.loreImportJob.findFirst.mockRejectedValue(new Error('db down'))
    const response = await GET(req(), { params: { id: 'camp1', jobId: 'job1' } })
    expect(response.status).toBe(500)
  })
})
