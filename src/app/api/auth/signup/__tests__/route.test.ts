// src/app/api/auth/signup/__tests__/route.test.ts
// Route-level: signup is the one path that creates a User row and now
// also grants the welcome credit — exercised here as an integration test
// so a regression in the credit wiring (or the duplicate-email/validation
// gates) is caught even though each piece has its own unit coverage.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn(), create: vi.fn() },
  },
}))
vi.mock('@/lib/password', () => ({
  hashPassword: vi.fn().mockResolvedValue('hashed-password'),
}))
vi.mock('@/lib/auth', () => ({
  createToken: vi.fn().mockReturnValue('fake-jwt-token'),
}))
vi.mock('@/lib/analytics/events', () => ({
  recordEvent: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/notifications/email-service', () => ({
  EmailService: { sendVerificationEmail: vi.fn().mockResolvedValue(undefined) },
}))
vi.mock('@/lib/payment/service', () => ({
  addFunds: vi.fn().mockResolvedValue({ success: true, newBalance: 100 }),
}))
vi.mock('@/lib/rateLimit', () => ({
  SIGNUP_LIMIT: { bucket: 'signup', limit: 5, windowSeconds: 3600 },
  checkRateLimit: vi.fn(),
  rateLimitExceededResponse: vi.fn(),
  getClientIp: vi.fn(() => '127.0.0.1'),
}))

import { prisma } from '@/lib/prisma'
import { addFunds } from '@/lib/payment/service'
import { recordEvent } from '@/lib/analytics/events'
import { checkRateLimit, rateLimitExceededResponse } from '@/lib/rateLimit'
import { POST } from '../route'

const db = prisma as any

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(addFunds as any).mockResolvedValue({ success: true, newBalance: 100 })
  ;(checkRateLimit as any).mockResolvedValue({ allowed: true })
})

describe('POST /api/auth/signup', () => {
  it('rejects a request missing email or password', async () => {
    const response = await POST(makeRequest({ email: 'a@b.com' }))
    expect(response.status).toBe(400)
    expect(db.user.create).not.toHaveBeenCalled()
  })

  it('rejects signup with an email already in use', async () => {
    db.user.findUnique.mockResolvedValue({ id: 'existing', email: 'a@b.com' })

    const response = await POST(makeRequest({ email: 'a@b.com', password: 'hunter2' }))

    expect(response.status).toBe(409)
    expect(db.user.create).not.toHaveBeenCalled()
  })

  it('creates the user, grants the welcome credit, and returns a token', async () => {
    db.user.findUnique.mockResolvedValue(null)
    db.user.create.mockResolvedValue({ id: 'new-user', email: 'new@example.com' })

    const response = await POST(makeRequest({ email: 'new@example.com', password: 'hunter2' }))

    expect(response.status).toBe(201)
    const json = await response.json()
    expect(json.token).toBe('fake-jwt-token')
    expect(json.user).toEqual({ id: 'new-user', email: 'new@example.com' })

    expect(db.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ email: 'new@example.com', password: 'hashed-password' }),
      })
    )
    expect(addFunds).toHaveBeenCalledWith(
      'new-user',
      100,
      expect.stringContaining('first scene')
    )
    expect(recordEvent).toHaveBeenCalledWith('SIGNUP', { userId: 'new-user' })
  })

  it('still succeeds if the welcome credit fails (best-effort, non-blocking)', async () => {
    db.user.findUnique.mockResolvedValue(null)
    db.user.create.mockResolvedValue({ id: 'new-user', email: 'new@example.com' })
    ;(addFunds as any).mockRejectedValue(new Error('payment service down'))

    const response = await POST(makeRequest({ email: 'new@example.com', password: 'hunter2' }))

    expect(response.status).toBe(201)
  })

  it('is rate limited by IP (#210)', async () => {
    ;(checkRateLimit as any).mockResolvedValue({ allowed: false, retryAfterSeconds: 42 })
    ;(rateLimitExceededResponse as any).mockReturnValue(new Response(null, { status: 429 }))

    const response = await POST(makeRequest({ email: 'new@example.com', password: 'hunter2' }))

    expect(response.status).toBe(429)
    expect(db.user.create).not.toHaveBeenCalled()
  })

  // #302: a case-variant of an existing account (or of a
  // PLATFORM_ADMIN_EMAILS entry) must not be able to create a second,
  // distinct account — normalized before both the existence check and the
  // create, not just at read time on the platform-admin gate's own side.
  it('#302: normalizes email to lowercase before the existence check and the create', async () => {
    db.user.findUnique.mockResolvedValue(null)
    db.user.create.mockResolvedValue({ id: 'new-user', email: 'boss@site.com' })

    const response = await POST(makeRequest({ email: 'BOSS@Site.com', password: 'hunter2' }))

    expect(response.status).toBe(201)
    expect(db.user.findUnique).toHaveBeenCalledWith({ where: { email: 'boss@site.com' } })
    expect(db.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ email: 'boss@site.com' }) })
    )
  })

  it('#302: a case-variant of an already-registered email is rejected as a duplicate', async () => {
    db.user.findUnique.mockResolvedValue({ id: 'existing', email: 'a@b.com' })

    const response = await POST(makeRequest({ email: 'A@B.com', password: 'hunter2' }))

    expect(response.status).toBe(409)
    expect(db.user.findUnique).toHaveBeenCalledWith({ where: { email: 'a@b.com' } })
    expect(db.user.create).not.toHaveBeenCalled()
  })

  it('#302: a genuine concurrent-signup race (findUnique missed it) still surfaces a clean 409, not a 500', async () => {
    const { Prisma } = await import('@prisma/client')
    db.user.findUnique.mockResolvedValue(null)
    db.user.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (email)', {
        code: 'P2002',
        clientVersion: '5.22.0',
        meta: { target: ['email'] },
      })
    )

    const response = await POST(makeRequest({ email: 'race@example.com', password: 'hunter2' }))

    expect(response.status).toBe(409)
  })
})
