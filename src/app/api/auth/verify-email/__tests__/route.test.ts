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
vi.mock('@/lib/rateLimit', () => ({
  VERIFY_EMAIL_LIMIT: { bucket: 'verify-email', limit: 10, windowSeconds: 3600 },
  checkRateLimit: vi.fn(),
  getClientIp: vi.fn(() => '127.0.0.1'),
}))
vi.mock('@/lib/payment/welcomeCredit', () => ({
  grantWelcomeCredit: vi.fn().mockResolvedValue({ granted: true }),
}))

import { prisma } from '@/lib/prisma'
import { checkRateLimit } from '@/lib/rateLimit'
import { grantWelcomeCredit } from '@/lib/payment/welcomeCredit'
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
  ;(checkRateLimit as any).mockResolvedValue({ allowed: true })
  ;(grantWelcomeCredit as any).mockResolvedValue({ granted: true })
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

  it('redirects to /login?verified=0 when rate limited, without touching the DB (#210)', async () => {
    ;(checkRateLimit as any).mockResolvedValue({ allowed: false, retryAfterSeconds: 42 })

    const response = await GET(req('good-token'))
    const location = redirectLocation(response)

    expect(location.searchParams.get('verified')).toBe('0')
    expect(db.user.findFirst).not.toHaveBeenCalled()
  })

  it('pays the welcome credit once the address is verified', async () => {
    // This is where the credit moved to, and why: an address that merely
    // parses is not a person, so signup no longer pays it out.
    db.user.findFirst.mockResolvedValue({ id: 'u1' })
    db.user.update.mockResolvedValue({ id: 'u1' })

    const response = await GET(req('good-token'))

    expect(redirectLocation(response).searchParams.get('verified')).toBe('1')
    expect(grantWelcomeCredit).toHaveBeenCalledWith('u1')
  })

  it('never pays the credit for a token that did not verify anyone', async () => {
    db.user.findFirst.mockResolvedValue(null)
    await GET(req('bad-token'))
    expect(grantWelcomeCredit).not.toHaveBeenCalled()
  })

  it('still reports success when the credit could not be paid', async () => {
    // Budget exhausted, or the payment layer is down. The account is
    // verified either way — a funding problem must not read to the user as
    // a failed verification.
    db.user.findFirst.mockResolvedValue({ id: 'u1' })
    db.user.update.mockResolvedValue({ id: 'u1' })
    ;(grantWelcomeCredit as any).mockResolvedValue({ granted: false, reason: 'budget-exhausted' })

    const response = await GET(req('good-token'))

    expect(redirectLocation(response).searchParams.get('verified')).toBe('1')
  })
})
