// src/app/api/tutorial/progress/__tests__/route.test.ts
// #135 (cont.) — the tutorial progress read had no test coverage: the
// auth gate was unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ verifyAuth: vi.fn() }))
vi.mock('@/lib/tutorial/tutorial-service', () => ({
  TutorialService: {
    getUserProgress: vi.fn(),
    getNextStep: vi.fn(),
    getCompletionPercentage: vi.fn(),
  },
}))

import { verifyAuth } from '@/lib/auth'
import { TutorialService } from '@/lib/tutorial/tutorial-service'
import { GET } from '../route'

function req() {
  return new NextRequest('http://localhost/api/tutorial/progress')
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(verifyAuth as any).mockResolvedValue({ userId: 'u1' })
  ;(TutorialService.getUserProgress as any).mockResolvedValue([{ stepId: 's1', completed: true }])
  ;(TutorialService.getNextStep as any).mockResolvedValue({ stepId: 's2' })
  ;(TutorialService.getCompletionPercentage as any).mockResolvedValue(50)
})

describe('GET', () => {
  it('rejects an unauthenticated request', async () => {
    ;(verifyAuth as any).mockResolvedValue(null)
    const response = await GET(req())
    expect(response.status).toBe(401)
    expect(TutorialService.getUserProgress).not.toHaveBeenCalled()
  })

  it('returns progress, next step, and completion percentage', async () => {
    const response = await GET(req())
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body).toEqual({
      progress: [{ stepId: 's1', completed: true }],
      nextStep: { stepId: 's2' },
      completionPercentage: 50,
    })
  })

  it('returns 500 on an unexpected error', async () => {
    ;(TutorialService.getUserProgress as any).mockRejectedValue(new Error('db down'))
    const response = await GET(req())
    expect(response.status).toBe(500)
  })
})
