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

import { prisma } from '@/lib/prisma'
import { addFunds } from '@/lib/payment/service'
import { recordEvent } from '@/lib/analytics/events'
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
})
