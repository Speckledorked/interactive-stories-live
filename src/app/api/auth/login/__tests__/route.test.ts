// src/app/api/auth/login/__tests__/route.test.ts
// #134 (cont.) — login had no test coverage: the "user not found" and
// "wrong password" paths both return the same generic error (no account
// enumeration), and an OAuth-only account (no password set) must fail the
// same way rather than throwing on a null password compare.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: { user: { findUnique: vi.fn(), update: vi.fn() } },
}))
vi.mock('@/lib/password', () => ({ verifyPassword: vi.fn() }))
vi.mock('@/lib/auth', () => ({ createToken: vi.fn() }))
vi.mock('@/lib/rateLimit', () => ({
  LOGIN_LIMIT: { bucket: 'login', limit: 10, windowSeconds: 300 },
  checkRateLimit: vi.fn(),
  rateLimitExceededResponse: vi.fn(),
  getClientIp: vi.fn(() => '127.0.0.1'),
}))

import { prisma } from '@/lib/prisma'
import { verifyPassword } from '@/lib/password'
import { createToken } from '@/lib/auth'
import { checkRateLimit, rateLimitExceededResponse } from '@/lib/rateLimit'
import { POST } from '../route'

const db = prisma as any

function loginRequest(body: unknown) {
  return new NextRequest('http://localhost/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(createToken as any).mockReturnValue('fake-jwt-token')
  ;(checkRateLimit as any).mockResolvedValue({ allowed: true })
  // The lastSeenAt stamp — fire-and-forget, must never fail a login.
  db.user.update.mockResolvedValue({})
})

describe('POST /api/auth/login', () => {
  it('rejects a request missing email or password', async () => {
    const response = await POST(loginRequest({ email: 'a@b.com' }))
    const body = await response.json()
    expect(response.status).toBe(400)
    expect(body.error).toBe('Email and password are required')
    expect(db.user.findUnique).not.toHaveBeenCalled()
  })

  it('rejects with a generic error when no account exists', async () => {
    db.user.findUnique.mockResolvedValue(null)
    const response = await POST(loginRequest({ email: 'nobody@example.com', password: 'hunter2' }))
    const body = await response.json()
    expect(response.status).toBe(401)
    expect(body.error).toBe('Invalid email or password')
  })

  it('rejects with the same generic error for an OAuth-only account (no password set)', async () => {
    db.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@b.com', password: null })
    const response = await POST(loginRequest({ email: 'a@b.com', password: 'hunter2' }))
    const body = await response.json()
    expect(response.status).toBe(401)
    expect(body.error).toBe('Invalid email or password')
    expect(verifyPassword).not.toHaveBeenCalled()
  })

  // #249 (adversarial audit): a status-only assertion here would pass
  // even if the wrong-password path started returning a different error
  // string than the no-account/OAuth-only paths do — exactly the kind of
  // same-status-wrong-body regression that would silently reintroduce
  // account enumeration (an attacker could tell "this email exists but
  // the password is wrong" from "no account with this email" by the
  // message alone, even with an identical 401 status on both).
  it('rejects an incorrect password with the same generic message the other 401 paths use, not a distinguishing one', async () => {
    db.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@b.com', password: 'hashed' })
    ;(verifyPassword as any).mockResolvedValue(false)
    const response = await POST(loginRequest({ email: 'a@b.com', password: 'wrong' }))
    const body = await response.json()
    expect(response.status).toBe(401)
    expect(body.error).toBe('Invalid email or password')
    expect(createToken).not.toHaveBeenCalled()
  })

  it('issues a token stamped with the account\'s current tokenVersion', async () => {
    db.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@b.com', password: 'hashed', tokenVersion: 3 })
    ;(verifyPassword as any).mockResolvedValue(true)

    const response = await POST(loginRequest({ email: 'a@b.com', password: 'hunter2' }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.token).toBe('fake-jwt-token')
    expect(body.user).toEqual({ id: 'u1', email: 'a@b.com' })
    expect(createToken).toHaveBeenCalledWith({ userId: 'u1', email: 'a@b.com', tokenVersion: 3 })
  })

  it('returns 500 with a generic message on an unexpected error, never the raw error text', async () => {
    db.user.findUnique.mockRejectedValue(new Error('db down: connection string exposed at 10.0.0.5'))
    const response = await POST(loginRequest({ email: 'a@b.com', password: 'hunter2' }))
    const body = await response.json()
    expect(response.status).toBe(500)
    expect(body.error).toBe('Internal server error')
  })

  it('is rate limited by IP+email before touching the DB (#210)', async () => {
    ;(checkRateLimit as any).mockResolvedValue({ allowed: false, retryAfterSeconds: 42 })
    ;(rateLimitExceededResponse as any).mockReturnValue(new Response(null, { status: 429 }))

    const response = await POST(loginRequest({ email: 'a@b.com', password: 'hunter2' }))

    expect(response.status).toBe(429)
    expect(db.user.findUnique).not.toHaveBeenCalled()
  })

  // #302: the account is always stored lowercase now (signup normalizes),
  // so a case-variant typed at login must still resolve to it.
  it('#302: normalizes email to lowercase before the lookup', async () => {
    db.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@b.com', password: 'hashed', tokenVersion: 1 })
    ;(verifyPassword as any).mockResolvedValue(true)

    const response = await POST(loginRequest({ email: 'A@B.com', password: 'hunter2' }))

    expect(response.status).toBe(200)
    expect(db.user.findUnique).toHaveBeenCalledWith({ where: { email: 'a@b.com' } })
  })
})
