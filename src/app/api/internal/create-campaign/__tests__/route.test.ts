// src/app/api/internal/create-campaign/__tests__/route.test.ts
// #493: the worker route that runs a campaign creation job in its own
// invocation. The gate is the point — this route can spend five billed
// model calls on behalf of a user it never authenticates, so it must be
// reachable only with the internal secret.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/game/resolutionQueue', () => ({ internalJobSecret: vi.fn() }))
vi.mock('@/lib/game/campaignCreationQueue', () => ({ processCampaignCreationJob: vi.fn() }))

import { internalJobSecret } from '@/lib/game/resolutionQueue'
import { processCampaignCreationJob } from '@/lib/game/campaignCreationQueue'
import { POST } from '../route'

function req(secret: string | undefined, body: unknown = { jobId: 'job1' }) {
  return new NextRequest('http://localhost/api/internal/create-campaign', {
    method: 'POST',
    headers: secret ? { 'x-internal-secret': secret, 'Content-Type': 'application/json' } : {},
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(internalJobSecret as any).mockReturnValue('s3cret')
  ;(processCampaignCreationJob as any).mockResolvedValue({ status: 'completed', campaignId: 'camp1' })
})

describe('the internal gate', () => {
  it('rejects a request with no secret', async () => {
    const response = await POST(req(undefined))
    expect(response.status).toBe(403)
    expect(processCampaignCreationJob).not.toHaveBeenCalled()
  })

  it('rejects a wrong secret', async () => {
    const response = await POST(req('guess'))
    expect(response.status).toBe(403)
    expect(processCampaignCreationJob).not.toHaveBeenCalled()
  })
})

describe('with the secret', () => {
  it('requires a jobId', async () => {
    const response = await POST(req('s3cret', {}))
    expect(response.status).toBe(400)
    expect(processCampaignCreationJob).not.toHaveBeenCalled()
  })

  it('runs the job and returns its result', async () => {
    const response = await POST(req('s3cret'))
    expect(await response.json()).toEqual({ status: 'completed', campaignId: 'camp1' })
    expect(processCampaignCreationJob).toHaveBeenCalledWith('job1')
  })
})
