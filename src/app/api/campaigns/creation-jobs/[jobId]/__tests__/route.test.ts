// src/app/api/campaigns/creation-jobs/[jobId]/__tests__/route.test.ts
// #493: what the creation modal polls. Scoped to the job's owner — a
// creation job carries the title and premise of a campaign that does not
// exist yet.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ getUser: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { campaignCreationJob: { findUnique: vi.fn() } },
}))

import { getUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { GET } from '../route'

const db = prisma as any
const params = { params: { jobId: 'job1' } }

function req() {
  return new NextRequest('http://localhost/api/campaigns/creation-jobs/job1')
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getUser as any).mockResolvedValue({ userId: 'u1' })
  db.campaignCreationJob.findUnique.mockResolvedValue({
    userId: 'u1', status: 'RUNNING', stage: 'WORLD', campaignId: null, lastError: null,
  })
})

describe('access', () => {
  it('rejects an unauthenticated request', async () => {
    ;(getUser as any).mockResolvedValue(null)
    expect((await GET(req(), params)).status).toBe(401)
  })

  it('404s on someone else\'s job rather than 403ing it', async () => {
    // A 403 would confirm the job id exists, which is the thing a 404 is
    // hiding.
    db.campaignCreationJob.findUnique.mockResolvedValue({ userId: 'someone-else', status: 'RUNNING', stage: 'WORLD' })
    expect((await GET(req(), params)).status).toBe(404)
  })

  it('404s on a job that does not exist, identically', async () => {
    db.campaignCreationJob.findUnique.mockResolvedValue(null)
    expect((await GET(req(), params)).status).toBe(404)
  })
})

describe('what it reports', () => {
  it('returns the stage with a sentence for it', async () => {
    const body = await (await GET(req(), params)).json()
    expect(body.stage).toBe('WORLD')
    expect(typeof body.label).toBe('string')
    expect(body.label.length).toBeGreaterThan(0)
  })

  it('returns the campaign to navigate to once it is done', async () => {
    db.campaignCreationJob.findUnique.mockResolvedValue({
      userId: 'u1', status: 'COMPLETED', stage: 'DONE', campaignId: 'camp1', lastError: null,
    })
    const body = await (await GET(req(), params)).json()
    expect(body).toMatchObject({ status: 'COMPLETED', campaignId: 'camp1' })
  })

  it('reports the error only once the job has actually given up', async () => {
    // A PENDING job carrying lastError is mid-retry. Showing that error
    // would report a failure to someone whose campaign is still on its way.
    db.campaignCreationJob.findUnique.mockResolvedValue({
      userId: 'u1', status: 'PENDING', stage: 'WORLD', campaignId: null, lastError: 'provider down',
    })
    expect((await (await GET(req(), params)).json()).error).toBeNull()

    db.campaignCreationJob.findUnique.mockResolvedValue({
      userId: 'u1', status: 'FAILED', stage: 'WORLD', campaignId: null, lastError: 'provider down',
    })
    expect((await (await GET(req(), params)).json()).error).toBe('provider down')
  })
})
