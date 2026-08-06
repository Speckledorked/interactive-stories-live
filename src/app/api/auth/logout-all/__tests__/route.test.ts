// src/app/api/auth/logout-all/__tests__/route.test.ts
// #134 (cont.) — "log out everywhere" had no test coverage: it's the one
// endpoint that invalidates the caller's OWN currently-valid token as its
// entire purpose, and is rate-limited since it writes to the user row on
// every call.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ getUser: vi.fn(), revokeAllSessions: vi.fn() }))
vi.mock('@/lib/rateLimit', () => ({
  SESSION_REVOKE_LIMIT: { bucket: 'session-revoke', limit: 5, windowSeconds: 300 },
  checkRateLimit: vi.fn(),
  rateLimitExceededResponse: vi.fn(),
}))

import { getUser, revokeAllSessions } from '@/lib/auth'
import { checkRateLimit, rateLimitExceededResponse } from '@/lib/rateLimit'
import { POST } from '../route'

function req() {
  return new NextRequest('http://localhost/api/auth/logout-all', { method: 'POST' })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getUser as any).mockResolvedValue({ userId: 'user1', email: 'user1@example.com' })
  ;(checkRateLimit as any).mockResolvedValue({ allowed: true })
})

describe('POST /api/auth/logout-all', () => {
  it('rejects an unauthenticated request', async () => {
    ;(getUser as any).mockResolvedValue(null)
    const response = await POST(req())
    expect(response.status).toBe(401)
    expect(revokeAllSessions).not.toHaveBeenCalled()
  })

  it('is rate limited', async () => {
    ;(checkRateLimit as any).mockResolvedValue({ allowed: false, retryAfterSeconds: 42 })
    ;(rateLimitExceededResponse as any).mockReturnValue(new Response(null, { status: 429 }))

    const response = await POST(req())

    expect(response.status).toBe(429)
    expect(revokeAllSessions).not.toHaveBeenCalled()
  })

  it('revokes every session for the caller and returns the new tokenVersion', async () => {
    ;(revokeAllSessions as any).mockResolvedValue(4)

    const response = await POST(req())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(revokeAllSessions).toHaveBeenCalledWith('user1')
    expect(body).toEqual(expect.objectContaining({ revoked: true, tokenVersion: 4 }))
  })

  it('returns 500 on an unexpected error', async () => {
    ;(revokeAllSessions as any).mockRejectedValue(new Error('db down'))
    const response = await POST(req())
    expect(response.status).toBe(500)
  })
})
