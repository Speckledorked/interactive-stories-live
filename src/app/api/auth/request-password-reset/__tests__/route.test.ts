// src/app/api/auth/request-password-reset/__tests__/route.test.ts
// #134 (cont.) — the no-account-enumeration guarantee (identical response
// whether or not the email exists) and the best-effort email send (a
// failed send must not fail the request) had no test coverage.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: { user: { findUnique: vi.fn(), update: vi.fn() } },
}))
vi.mock('@/lib/notifications/email-service', () => ({
  EmailService: { sendPasswordResetEmail: vi.fn() },
}))
vi.mock('@/lib/rateLimit', () => ({
  PASSWORD_RESET_REQUEST_LIMIT: { bucket: 'password-reset-request', limit: 3, windowSeconds: 3600 },
  checkRateLimit: vi.fn(),
  rateLimitExceededResponse: vi.fn(),
}))

import { prisma } from '@/lib/prisma'
import { EmailService } from '@/lib/notifications/email-service'
import { checkRateLimit, rateLimitExceededResponse } from '@/lib/rateLimit'
import { POST } from '../route'

const db = prisma as any

function req(body: unknown) {
  return new NextRequest('http://localhost/api/auth/request-password-reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(EmailService.sendPasswordResetEmail as any).mockResolvedValue(undefined)
  ;(checkRateLimit as any).mockResolvedValue({ allowed: true })
})

describe('POST /api/auth/request-password-reset', () => {
  it('rejects a request missing an email', async () => {
    const response = await POST(req({}))
    expect(response.status).toBe(400)
  })

  it('returns the identical success response when no account exists (no enumeration)', async () => {
    db.user.findUnique.mockResolvedValue(null)
    const response = await POST(req({ email: 'nobody@example.com' }))
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(db.user.update).not.toHaveBeenCalled()
    expect(EmailService.sendPasswordResetEmail).not.toHaveBeenCalled()
  })

  it('sets a reset token and sends the email when the account exists', async () => {
    db.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@b.com' })
    db.user.update.mockResolvedValue({ id: 'u1' })

    const response = await POST(req({ email: 'a@b.com' }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: expect.objectContaining({ resetToken: expect.any(String), resetTokenExpires: expect.any(Date) }),
    })
    expect(EmailService.sendPasswordResetEmail).toHaveBeenCalledWith('a@b.com', expect.any(String))
  })

  it('still returns success when the reset email fails to send (best-effort)', async () => {
    db.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@b.com' })
    db.user.update.mockResolvedValue({ id: 'u1' })
    ;(EmailService.sendPasswordResetEmail as any).mockRejectedValue(new Error('smtp down'))

    const response = await POST(req({ email: 'a@b.com' }))

    expect(response.status).toBe(200)
  })

  it('returns 500 on an unexpected error', async () => {
    db.user.findUnique.mockRejectedValue(new Error('db down'))
    const response = await POST(req({ email: 'a@b.com' }))
    expect(response.status).toBe(500)
  })

  it('is rate limited by the target email before touching the DB (#210)', async () => {
    ;(checkRateLimit as any).mockResolvedValue({ allowed: false, retryAfterSeconds: 42 })
    ;(rateLimitExceededResponse as any).mockReturnValue(new Response(null, { status: 429 }))

    const response = await POST(req({ email: 'a@b.com' }))

    expect(response.status).toBe(429)
    expect(db.user.findUnique).not.toHaveBeenCalled()
  })
})
