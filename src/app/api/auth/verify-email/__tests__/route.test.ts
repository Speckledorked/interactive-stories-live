// src/app/api/auth/verify-email/__tests__/route.test.ts
// #134 (cont.) — the email-verification landing redirect had no test
// coverage: missing token, unrecognized token, and an unexpected error
// must all degrade to the same "verified=0" redirect rather than a bare
// error page, since this link is clicked from an email client.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: { user: { findFirst: vi.fn(), update: vi.fn() } },
}))

import { prisma } from '@/lib/prisma'
import { GET } from '../route'

const db = prisma as any

function req(token?: string) {
  const url = token
    ? `http://localhost/api/auth/verify-email?token=${token}`
    : 'http://localhost/api/auth/verify-email'
  return new NextRequest(url)
}

function redirectLocation(response: Response): URL {
  return new URL(response.headers.get('location')!)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/auth/verify-email', () => {
  it('redirects to /login?verified=0 when no token is present', async () => {
    const response = await GET(req())
    expect(response.status).toBeGreaterThanOrEqual(300)
    expect(response.status).toBeLessThan(400)
    const location = redirectLocation(response)
    expect(location.pathname).toBe('/login')
    expect(location.searchParams.get('verified')).toBe('0')
    expect(db.user.update).not.toHaveBeenCalled()
  })

  it('redirects to /login?verified=0 for an unrecognized token', async () => {
    db.user.findFirst.mockResolvedValue(null)
    const response = await GET(req('bad-token'))
    const location = redirectLocation(response)
    expect(location.searchParams.get('verified')).toBe('0')
    expect(db.user.update).not.toHaveBeenCalled()
  })

  it('marks the account verified and redirects to /login?verified=1 for a valid token', async () => {
    db.user.findFirst.mockResolvedValue({ id: 'u1', emailVerifyToken: 'good-token' })
    db.user.update.mockResolvedValue({ id: 'u1' })

    const response = await GET(req('good-token'))
    const location = redirectLocation(response)

    expect(location.searchParams.get('verified')).toBe('1')
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { emailVerified: true, emailVerifyToken: null },
    })
  })

  it('redirects to /login?verified=0 on an unexpected error, not a bare error page', async () => {
    db.user.findFirst.mockRejectedValue(new Error('db down'))
    const response = await GET(req('some-token'))
    const location = redirectLocation(response)
    expect(location.searchParams.get('verified')).toBe('0')
  })
})
