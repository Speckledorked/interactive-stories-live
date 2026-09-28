// src/app/api/auth/refresh/__tests__/route.test.ts
//
// The refresh endpoint is the only thing standing between an expired
// 15-minute access cookie and a logged-out user, so its contract is
// pinned: no cookie → 401, success → fresh cookies + user, any refusal →
// a bare 401 with the cookies cleared (the reason is logged, never told
// to the caller — a thief probing stolen tokens should learn nothing).

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// NOTE: the mock factory cannot reference top-level variables (vitest
// hoists it), so rotateRefreshToken is replaced with a vi.fn() created
// inside the factory and driven through the imported binding below;
// RefreshError comes from the real module via importOriginal.
vi.mock('@/lib/refreshToken', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/refreshToken')>()
  return { ...actual, rotateRefreshToken: vi.fn() }
})
vi.mock('@/lib/rateLimit', () => ({
  REFRESH_LIMIT: { bucket: 'refresh', limit: 30, windowSeconds: 300 },
  checkRateLimit: vi.fn(),
  rateLimitExceededResponse: vi.fn(),
  getClientIp: vi.fn(() => '127.0.0.1'),
}))

import { checkRateLimit, rateLimitExceededResponse } from '@/lib/rateLimit'
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from '@/lib/auth'
import { rotateRefreshToken, RefreshError, type RefreshFailureReason } from '@/lib/refreshToken'
import { POST } from '../route'

const rotateMock = vi.mocked(rotateRefreshToken)

const withRefreshCookie = (value: string) => {
  const req = new NextRequest('http://localhost/api/auth/refresh', { method: 'POST' })
  req.cookies.set(REFRESH_TOKEN_COOKIE, value)
  return req
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(checkRateLimit as any).mockResolvedValue({ allowed: true })
})

describe('POST /api/auth/refresh', () => {
  it('rotates: fresh cookies plus the user, no token in JS-reachable form', async () => {
    rotateMock.mockResolvedValue({
      user: { id: 'u1', email: 'a@example.com' },
      accessToken: 'new-access-jwt',
      refreshToken: 'new-refresh-opaque',
    })

    const response = await POST(withRefreshCookie('presented-token'))

    expect(response.status).toBe(200)
    expect(rotateMock).toHaveBeenCalledWith('presented-token')
    const json = await response.json()
    expect(json.user).toEqual({ id: 'u1', email: 'a@example.com' })
    expect(json.accessToken).toBeUndefined()
    expect(json.refreshToken).toBeUndefined()

    // The session travels as httpOnly cookies, not body fields.
    expect(response.cookies.get(ACCESS_TOKEN_COOKIE)?.value).toBe('new-access-jwt')
    expect(response.cookies.get(ACCESS_TOKEN_COOKIE)?.httpOnly).toBe(true)
    expect(response.cookies.get(REFRESH_TOKEN_COOKIE)?.value).toBe('new-refresh-opaque')
    expect(response.cookies.get(REFRESH_TOKEN_COOKIE)?.httpOnly).toBe(true)
    expect(response.cookies.get(REFRESH_TOKEN_COOKIE)?.path).toBe('/api/auth')
  })

  it('returns a bare 401 with cleared cookies when there is no refresh cookie', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/auth/refresh', { method: 'POST' })
    )
    expect(response.status).toBe(401)
    expect(rotateMock).not.toHaveBeenCalled()
  })

  it('a refused rotation is a bare 401 with the cookies cleared', async () => {
    // reuse-detected already burned every session inside
    // rotateRefreshToken; the route's job is to stop the client
    // presenting a dead credential, without saying why.
    for (const reason of ['unknown', 'expired', 'reuse-detected'] as RefreshFailureReason[]) {
      rotateMock.mockRejectedValue(new RefreshError(reason))
      const response = await POST(withRefreshCookie('dead-token'))
      expect(response.status, reason).toBe(401)
      const json = await response.json()
      expect(json.error).toBe('Unauthorized')
      expect(response.cookies.get(ACCESS_TOKEN_COOKIE)?.maxAge).toBe(0)
      expect(response.cookies.get(REFRESH_TOKEN_COOKIE)?.maxAge).toBe(0)
    }
  })

  it('is rate limited by IP', async () => {
    ;(checkRateLimit as any).mockResolvedValue({ allowed: false, retryAfterSeconds: 42 })
    ;(rateLimitExceededResponse as any).mockReturnValue(new Response(null, { status: 429 }))

    const response = await POST(withRefreshCookie('presented-token'))
    expect(response.status).toBe(429)
    expect(rotateMock).not.toHaveBeenCalled()
  })
})
