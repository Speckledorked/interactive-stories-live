// src/app/api/tutorial/steps/[stepId]/complete/__tests__/route.test.ts
// #135 (cont.) — completing a tutorial step had no test coverage: the
// auth gate, and that the stepId route param is what's actually passed
// through to the service, were both unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ verifyAuth: vi.fn() }))
vi.mock('@/lib/tutorial/tutorial-service', () => ({
  TutorialService: { completeStep: vi.fn() },
}))

import { verifyAuth } from '@/lib/auth'
import { TutorialService } from '@/lib/tutorial/tutorial-service'
import { POST } from '../route'

function req() {
  return new NextRequest('http://localhost/api/tutorial/steps/step1/complete', { method: 'POST' })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(verifyAuth as any).mockResolvedValue({ userId: 'u1' })
  ;(TutorialService.completeStep as any).mockResolvedValue({ stepId: 'step1', completed: true })
})

describe('POST', () => {
  it('rejects an unauthenticated request', async () => {
    ;(verifyAuth as any).mockResolvedValue(null)
    const response = await POST(req(), { params: { stepId: 'step1' } })
    expect(response.status).toBe(401)
    expect(TutorialService.completeStep).not.toHaveBeenCalled()
  })

  it('completes the step named in the route param', async () => {
    const response = await POST(req(), { params: { stepId: 'step1' } })
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(TutorialService.completeStep).toHaveBeenCalledWith('u1', 'step1')
    expect(body).toEqual({ stepId: 'step1', completed: true })
  })

  it('returns 500 on an unexpected error', async () => {
    ;(TutorialService.completeStep as any).mockRejectedValue(new Error('db down'))
    const response = await POST(req(), { params: { stepId: 'step1' } })
    expect(response.status).toBe(500)
  })
})
