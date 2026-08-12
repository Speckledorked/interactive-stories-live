// src/app/api/auth/reset-password/__tests__/route.test.ts
// #134 (cont.) — completing a password reset had no test coverage: the
// expired-token check, and that completing a reset also marks the account
// email-verified (proving inbox control is verification), were both
// unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: { user: { findFirst: vi.fn(), update: vi.fn() } },
}))
vi.mock('@/lib/password', () => ({ hashPassword: vi.fn() }))
vi.mock('@/lib/rateLimit', () => ({
  RESET_PASSWORD_LIMIT: { bucket: 'reset-password', limit: 10, windowSeconds: 3600 },
  checkRateLimit: vi.fn(),
  rateLimitExceededResponse: vi.fn(),
  getClientIp: vi.fn(() => '127.0.0.1'),
}))

import { prisma } from '@/lib/prisma'
import { hashPassword } from '@/lib/password'
import { checkRateLimit, rateLimitExceededResponse } from '@/lib/rateLimit'
import { POST } from '../route'

const db = prisma as any

function req(body: unknown) {
  return new NextRequest('http://localhost/api/auth/reset-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(hashPassword as any).mockResolvedValue('new-hashed-password')
  ;(checkRateLimit as any).mockResolvedValue({ allowed: true })
})

describe('POST /api/auth/reset-password', () => {
  it('rejects a request missing a token', async () => {
    const response = await POST(req({ password: 'longenough' }))
    expect(response.status).toBe(400)
  })

  it('rejects a password shorter than 8 characters', async () => {
    const response = await POST(req({ token: 'tok', password: 'short' }))
    expect(response.status).toBe(400)
    expect(db.user.findFirst).not.toHaveBeenCalled()
  })

  it('rejects an unrecognized token', async () => {
    db.user.findFirst.mockResolvedValue(null)
    const response = await POST(req({ token: 'bad-token', password: 'longenough' }))
    expect(response.status).toBe(400)
  })

  it('rejects an expired token', async () => {
    db.user.findFirst.mockResolvedValue({ id: 'u1', resetTokenExpires: new Date(Date.now() - 1000) })
    const response = await POST(req({ token: 'expired-token', password: 'longenough' }))
    expect(response.status).toBe(400)
    expect(db.user.update).not.toHaveBeenCalled()
  })

  it('updates the password, clears the reset token, and marks the account verified', async () => {
    db.user.findFirst.mockResolvedValue({ id: 'u1', resetTokenExpires: new Date(Date.now() + 60_000) })
    db.user.update.mockResolvedValue({ id: 'u1' })

    const response = await POST(req({ token: 'good-token', password: 'longenough' }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: {
        password: 'new-hashed-password',
        resetToken: null,
        resetTokenExpires: null,
        emailVerified: true,
        emailVerifyToken: null,
      },
    })
  })

  it('returns 500 on an unexpected error', async () => {
    db.user.findFirst.mockRejectedValue(new Error('db down'))
    const response = await POST(req({ token: 'tok', password: 'longenough' }))
    expect(response.status).toBe(500)
  })

  it('is rate limited by IP before looking up the token (#210)', async () => {
    ;(checkRateLimit as any).mockResolvedValue({ allowed: false, retryAfterSeconds: 42 })
    ;(rateLimitExceededResponse as any).mockReturnValue(new Response(null, { status: 429 }))

    const response = await POST(req({ token: 'good-token', password: 'longenough' }))

    expect(response.status).toBe(429)
    expect(db.user.findFirst).not.toHaveBeenCalled()
  })
})
