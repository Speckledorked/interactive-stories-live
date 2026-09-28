// src/app/api/auth/logout/__tests__/route.test.ts
//
// Logout revokes the presented refresh token and clears both session
// cookies. It is idempotent by design: a missing or already-dead refresh
// cookie still returns 200 with the cookies cleared, because logout must
// never fail — the client's only job after this is to forget everything
// and go to /login.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/refreshToken', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/refreshToken')>()
  return { ...actual, revokeRefreshToken: vi.fn() }
})

import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from '@/lib/auth'
import { revokeRefreshToken } from '@/lib/refreshToken'
import { POST } from '../route'

const withRefreshCookie = (value: string) => {
  const req = new NextRequest('http://localhost/api/auth/logout', { method: 'POST' })
  req.cookies.set(REFRESH_TOKEN_COOKIE, value)
  return req
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/auth/logout', () => {
  it('revokes the presented refresh token and clears both cookies', async () => {
    const response = await POST(withRefreshCookie('presented-token'))

    expect(response.status).toBe(200)
    expect(revokeRefreshToken).toHaveBeenCalledWith('presented-token')
    // Both cookies expired on their original paths, so the browser
    // actually drops them.
    expect(response.cookies.get(ACCESS_TOKEN_COOKIE)?.maxAge).toBe(0)
    expect(response.cookies.get(ACCESS_TOKEN_COOKIE)?.path).toBe('/')
    expect(response.cookies.get(REFRESH_TOKEN_COOKIE)?.maxAge).toBe(0)
    expect(response.cookies.get(REFRESH_TOKEN_COOKIE)?.path).toBe('/api/auth')
  })

  it('is idempotent: no cookie still returns 200 with cleared cookies', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/auth/logout', { method: 'POST' })
    )
    expect(response.status).toBe(200)
    expect(revokeRefreshToken).not.toHaveBeenCalled()
    expect(response.cookies.get(ACCESS_TOKEN_COOKIE)?.maxAge).toBe(0)
    expect(response.cookies.get(REFRESH_TOKEN_COOKIE)?.maxAge).toBe(0)
  })
})
