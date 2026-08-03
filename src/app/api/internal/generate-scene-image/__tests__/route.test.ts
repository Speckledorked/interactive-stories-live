// src/app/api/internal/generate-scene-image/__tests__/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/game/imageGenQueue', () => ({
  processImageGenJob: vi.fn(),
  sweepGloballyStuckImageJobs: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/game/resolutionQueue', () => ({
  internalJobSecret: vi.fn().mockReturnValue('shared-secret'),
}))

import { processImageGenJob, sweepGloballyStuckImageJobs } from '@/lib/game/imageGenQueue'
import { POST } from '../route'

function req(body: unknown, secret?: string) {
  return new NextRequest('http://localhost/api/internal/generate-scene-image', {
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
    const response = await POST(req({ jobId: 'img1' }))
    expect(response.status).toBe(403)
    expect(processImageGenJob).not.toHaveBeenCalled()
  })

  it('rejects a request with the wrong secret', async () => {
    const response = await POST(req({ jobId: 'img1' }, 'wrong-secret'))
    expect(response.status).toBe(403)
    expect(processImageGenJob).not.toHaveBeenCalled()
  })

  it('rejects a missing jobId', async () => {
    const response = await POST(req({}, 'shared-secret'))
    expect(response.status).toBe(400)
    expect(processImageGenJob).not.toHaveBeenCalled()
  })

  it('processes the job and sweeps for globally stuck jobs', async () => {
    ;(processImageGenJob as any).mockResolvedValue({ status: 'completed' })

    const response = await POST(req({ jobId: 'img1' }, 'shared-secret'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ status: 'completed' })
    expect(processImageGenJob).toHaveBeenCalledWith('img1')
    expect(sweepGloballyStuckImageJobs).toHaveBeenCalledTimes(1)
  })
})
