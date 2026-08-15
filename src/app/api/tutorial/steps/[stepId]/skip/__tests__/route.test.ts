// src/app/api/tutorial/steps/[stepId]/skip/__tests__/route.test.ts
// #135 (cont.) — skipping a tutorial step had no test coverage: the auth
// gate, and that the stepId route param is what's actually passed
// through to the service, were both unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ verifyAuth: vi.fn() }))
vi.mock('@/lib/tutorial/tutorial-service', () => ({
  TutorialService: { skipStep: vi.fn() },
}))

import { verifyAuth } from '@/lib/auth'
import { TutorialService } from '@/lib/tutorial/tutorial-service'
import { POST } from '../route'

function req() {
  return new NextRequest('http://localhost/api/tutorial/steps/step1/skip', { method: 'POST' })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(verifyAuth as any).mockResolvedValue({ userId: 'u1' })
  ;(TutorialService.skipStep as any).mockResolvedValue({ stepId: 'step1', skipped: true })
})

describe('POST', () => {
  it('rejects an unauthenticated request', async () => {
    ;(verifyAuth as any).mockResolvedValue(null)
    const response = await POST(req(), { params: { stepId: 'step1' } })
    expect(response.status).toBe(401)
    expect(TutorialService.skipStep).not.toHaveBeenCalled()
  })

  it('skips the step named in the route param', async () => {
    const response = await POST(req(), { params: { stepId: 'step1' } })
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(TutorialService.skipStep).toHaveBeenCalledWith('u1', 'step1')
    expect(body).toEqual({ stepId: 'step1', skipped: true })
  })

  it('returns 500 on an unexpected error', async () => {
    ;(TutorialService.skipStep as any).mockRejectedValue(new Error('db down'))
    const response = await POST(req(), { params: { stepId: 'step1' } })
    expect(response.status).toBe(500)
  })

  // #318: skipping a required step is a client error, not a server fault.
  it('returns 400, not 500, when the service rejects skipping a required step', async () => {
    ;(TutorialService.skipStep as any).mockRejectedValue(new Error('Cannot skip "create_character": it is a required step'))
    const response = await POST(req(), { params: { stepId: 'step1' } })
    expect(response.status).toBe(400)
  })

  it('returns 400, not 500, when the step does not exist', async () => {
    ;(TutorialService.skipStep as any).mockRejectedValue(new Error('Tutorial step not found'))
    const response = await POST(req(), { params: { stepId: 'step1' } })
    expect(response.status).toBe(400)
  })
})
