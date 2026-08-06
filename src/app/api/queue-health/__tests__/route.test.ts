// src/app/api/queue-health/__tests__/route.test.ts
// #135 (cont.) — the resolution-queue diagnostic page had no test
// coverage: the rate limit, the required `?campaign=` param, and that
// visiting the page always sweeps stale jobs first (visiting it IS the
// retry loop), were all unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/rateLimit', () => ({ checkRateLimit: vi.fn() }))
vi.mock('@/lib/game/resolutionQueue', () => ({ recoverStaleJobs: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { resolutionJob: { findMany: vi.fn() } },
}))

import { checkRateLimit } from '@/lib/rateLimit'
import { recoverStaleJobs } from '@/lib/game/resolutionQueue'
import { prisma } from '@/lib/prisma'
import { GET } from '../route'

const db = prisma as any

function req(query = '') {
  return new NextRequest(`http://localhost/api/queue-health${query}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(checkRateLimit as any).mockResolvedValue({ allowed: true })
  db.resolutionJob.findMany.mockResolvedValue([])
})

describe('GET', () => {
  it('is rate limited', async () => {
    ;(checkRateLimit as any).mockResolvedValue({ allowed: false })
    const response = await GET(req('?campaign=camp1'))
    expect(response.status).toBe(429)
    expect(recoverStaleJobs).not.toHaveBeenCalled()
  })

  it('requires a campaign id', async () => {
    const response = await GET(req())
    expect(response.status).toBe(400)
    expect(recoverStaleJobs).not.toHaveBeenCalled()
  })

  it('sweeps stale jobs before reading, since visiting the page IS the retry loop', async () => {
    await GET(req('?campaign=camp1'))
    expect(recoverStaleJobs).toHaveBeenCalledWith('camp1')
  })

  it('truncates a long lastError and notes when there are no jobs at all', async () => {
    db.resolutionJob.findMany.mockResolvedValue([])
    const response = await GET(req('?campaign=camp1'))
    const body = await response.json()
    expect(body.jobCount).toBe(0)
    expect(body.note).toContain('never enqueued')
  })

  it('returns the most recent jobs with truncated errors', async () => {
    db.resolutionJob.findMany.mockResolvedValue([
      { id: 'j1', sceneId: 's1', status: 'FAILED', attempts: 3, lastError: 'x'.repeat(500), createdAt: new Date(), startedAt: new Date(), finishedAt: new Date() },
    ])
    const response = await GET(req('?campaign=camp1'))
    const body = await response.json()
    expect(body.jobs[0].lastError.length).toBe(300)
    expect(body.note).toBeUndefined()
  })
})
