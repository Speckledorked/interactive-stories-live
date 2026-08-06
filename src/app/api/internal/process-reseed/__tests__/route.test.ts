// src/app/api/internal/process-reseed/__tests__/route.test.ts
// #135 (cont.) — the world-reseed worker route had no test coverage: the
// shared internal-secret gate, the required jobId body field, and that
// the global stuck-reseed-job sweep always runs after processing, were
// all unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/lore/reseedQueue', () => ({
  processReseedJob: vi.fn(),
  sweepGloballyStuckReseedJobs: vi.fn(),
}))
vi.mock('@/lib/game/resolutionQueue', () => ({ internalJobSecret: vi.fn(() => 'internal-secret') }))

import { processReseedJob, sweepGloballyStuckReseedJobs } from '@/lib/lore/reseedQueue'
import { POST } from '../route'

function req(body: unknown, secret = 'internal-secret') {
  return new NextRequest('http://localhost/api/internal/process-reseed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-secret': secret },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(processReseedJob as any).mockResolvedValue({ status: 'completed' })
  ;(sweepGloballyStuckReseedJobs as any).mockResolvedValue(undefined)
})

describe('POST', () => {
  it('rejects the wrong secret', async () => {
    const response = await POST(req({ jobId: 'job1' }, 'wrong-secret'))
    expect(response.status).toBe(403)
    expect(processReseedJob).not.toHaveBeenCalled()
  })

  it('requires jobId', async () => {
    const response = await POST(req({}))
    expect(response.status).toBe(400)
    expect(processReseedJob).not.toHaveBeenCalled()
  })

  it('processes the job and always sweeps stuck reseed jobs afterward', async () => {
    const response = await POST(req({ jobId: 'job1' }))
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body).toEqual({ status: 'completed' })
    expect(processReseedJob).toHaveBeenCalledWith('job1')
    expect(sweepGloballyStuckReseedJobs).toHaveBeenCalled()
  })
})
