// src/app/api/tutorial/trigger/__tests__/route.test.ts
// #135 (cont.) — the tutorial trigger-event route had no test coverage:
// the auth gate (called out in the route's own comment as a previously
// missing special-case — an unauthenticated request used to fall through
// to a bare 500 instead of 401) and the required `trigger` field were
// both unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn() }))
vi.mock('@/lib/tutorial/tutorial-service', () => ({
  TutorialService: { handleTriggerEvent: vi.fn() },
}))

import { requireAuth } from '@/lib/auth'
import { TutorialService } from '@/lib/tutorial/tutorial-service'
import { POST } from '../route'

function req(body: unknown) {
  return new NextRequest('http://localhost/api/tutorial/trigger', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(requireAuth as any).mockResolvedValue({ userId: 'u1' })
})

describe('POST', () => {
  it('rejects an unauthenticated request with 401, not a bare 500', async () => {
    ;(requireAuth as any).mockRejectedValue(new Error('Unauthorized'))
    const response = await POST(req({ trigger: 'shortcuts_viewed' }))
    expect(response.status).toBe(401)
    expect(TutorialService.handleTriggerEvent).not.toHaveBeenCalled()
  })

  it('requires a trigger type', async () => {
    const response = await POST(req({}))
    expect(response.status).toBe(400)
    expect(TutorialService.handleTriggerEvent).not.toHaveBeenCalled()
  })

  it('handles the trigger event with its metadata', async () => {
    const response = await POST(req({ trigger: 'character_created', metadata: { characterId: 'c1' } }))
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body).toEqual({ success: true })
    expect(TutorialService.handleTriggerEvent).toHaveBeenCalledWith('u1', 'character_created', { characterId: 'c1' })
  })

  it('returns 500 on an unexpected error', async () => {
    ;(TutorialService.handleTriggerEvent as any).mockRejectedValue(new Error('db down'))
    const response = await POST(req({ trigger: 'x' }))
    expect(response.status).toBe(500)
  })
})
