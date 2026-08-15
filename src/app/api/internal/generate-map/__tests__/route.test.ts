// src/app/api/internal/generate-map/__tests__/route.test.ts
// #291: mirrors generate-scene-image's own route test exactly — same
// worker-route shape, same auth/validation/sweep contract.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/game/mapGenQueue', () => ({
  processMapGenJob: vi.fn(),
  sweepGloballyStuckMapJobs: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/game/resolutionQueue', () => ({
  internalJobSecret: vi.fn().mockReturnValue('shared-secret'),
}))

import { processMapGenJob, sweepGloballyStuckMapJobs } from '@/lib/game/mapGenQueue'
import { POST } from '../route'

function req(body: unknown, secret?: string) {
  return new NextRequest('http://localhost/api/internal/generate-map', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(secret !== undefined ? { 'x-internal-secret': secret } : {}),
    },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST', () => {
  it('rejects a request with no secret', async () => {
    const response = await POST(req({ jobId: 'map1' }))
    expect(response.status).toBe(403)
    expect(processMapGenJob).not.toHaveBeenCalled()
  })

  it('rejects a request with the wrong secret', async () => {
    const response = await POST(req({ jobId: 'map1' }, 'wrong-secret'))
    expect(response.status).toBe(403)
    expect(processMapGenJob).not.toHaveBeenCalled()
  })

  it('rejects a missing jobId', async () => {
    const response = await POST(req({}, 'shared-secret'))
    expect(response.status).toBe(400)
    expect(processMapGenJob).not.toHaveBeenCalled()
  })

  it('processes the job and sweeps for globally stuck jobs', async () => {
    ;(processMapGenJob as any).mockResolvedValue({ status: 'completed' })

    const response = await POST(req({ jobId: 'map1' }, 'shared-secret'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ status: 'completed' })
    expect(processMapGenJob).toHaveBeenCalledWith('map1')
    expect(sweepGloballyStuckMapJobs).toHaveBeenCalledTimes(1)
  })
})
