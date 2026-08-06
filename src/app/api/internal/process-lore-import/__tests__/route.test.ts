// src/app/api/internal/process-lore-import/__tests__/route.test.ts
// #135 (cont.) — the lore-import worker route had no test coverage: the
// shared internal-secret gate, the required jobId body field, and that
// the global stuck-lore-job sweep always runs after processing (the #12
// alpha instrumentation hook), were all unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/lore/loreQueue', () => ({
  processLoreImportJob: vi.fn(),
  sweepGloballyStuckLoreJobs: vi.fn(),
}))
vi.mock('@/lib/game/resolutionQueue', () => ({ internalJobSecret: vi.fn(() => 'internal-secret') }))

import { processLoreImportJob, sweepGloballyStuckLoreJobs } from '@/lib/lore/loreQueue'
import { POST } from '../route'

function req(body: unknown, secret = 'internal-secret') {
  return new NextRequest('http://localhost/api/internal/process-lore-import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-secret': secret },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(processLoreImportJob as any).mockResolvedValue({ status: 'completed' })
  ;(sweepGloballyStuckLoreJobs as any).mockResolvedValue(undefined)
})

describe('POST', () => {
  it('rejects the wrong secret', async () => {
    const response = await POST(req({ jobId: 'job1' }, 'wrong-secret'))
    expect(response.status).toBe(403)
    expect(processLoreImportJob).not.toHaveBeenCalled()
  })

  it('requires jobId', async () => {
    const response = await POST(req({}))
    expect(response.status).toBe(400)
    expect(processLoreImportJob).not.toHaveBeenCalled()
  })

  it('processes the job and always sweeps stuck lore jobs afterward', async () => {
    const response = await POST(req({ jobId: 'job1' }))
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body).toEqual({ status: 'completed' })
    expect(processLoreImportJob).toHaveBeenCalledWith('job1')
    expect(sweepGloballyStuckLoreJobs).toHaveBeenCalled()
  })
})
