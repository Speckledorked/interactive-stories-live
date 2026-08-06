// src/app/api/internal/resolve-job/__tests__/route.test.ts
// #135 (cont.) — the scene-resolution worker route had no test coverage:
// the shared internal-secret gate, the required jobId body field, and
// that the global stuck-resolution-job sweep is AWAITED (not
// fire-and-forget — a frozen serverless function can't finish a detached
// promise) after processing, were all unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/game/resolutionQueue', () => ({
  processResolutionJob: vi.fn(),
  internalJobSecret: vi.fn(() => 'internal-secret'),
  sweepGloballyStuckResolutionJobs: vi.fn(),
}))

import { processResolutionJob, sweepGloballyStuckResolutionJobs } from '@/lib/game/resolutionQueue'
import { POST } from '../route'

function req(body: unknown, secret = 'internal-secret') {
  return new NextRequest('http://localhost/api/internal/resolve-job', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-secret': secret },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(processResolutionJob as any).mockResolvedValue({ status: 'completed' })
  ;(sweepGloballyStuckResolutionJobs as any).mockResolvedValue(undefined)
})

describe('POST', () => {
  it('rejects the wrong secret', async () => {
    const response = await POST(req({ jobId: 'job1' }, 'wrong-secret'))
    expect(response.status).toBe(403)
    expect(processResolutionJob).not.toHaveBeenCalled()
  })

  it('requires jobId', async () => {
    const response = await POST(req({}))
    expect(response.status).toBe(400)
    expect(processResolutionJob).not.toHaveBeenCalled()
  })

  it('processes the job and awaits the stuck-job sweep afterward', async () => {
    const response = await POST(req({ jobId: 'job1' }))
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body).toEqual({ status: 'completed' })
    expect(processResolutionJob).toHaveBeenCalledWith('job1')
    expect(sweepGloballyStuckResolutionJobs).toHaveBeenCalled()
  })
})
