// src/app/api/auth/login/__tests__/route.test.ts
// #134 (cont.) — login had no test coverage: the "user not found" and
// "wrong password" paths both return the same generic error (no account
// enumeration), and an OAuth-only account (no password set) must fail the
// same way rather than throwing on a null password compare.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: { user: { findUnique: vi.fn() } },
}))
vi.mock('@/lib/password', () => ({ verifyPassword: vi.fn() }))
vi.mock('@/lib/auth', () => ({ createToken: vi.fn() }))

import { prisma } from '@/lib/prisma'
import { verifyPassword } from '@/lib/password'
import { createToken } from '@/lib/auth'
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
})

describe('POST /api/auth/login', () => {
  it('rejects a request missing email or password', async () => {
    const response = await POST(loginRequest({ email: 'a@b.com' }))
    expect(response.status).toBe(400)
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

  it('rejects an incorrect password', async () => {
    db.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@b.com', password: 'hashed' })
    ;(verifyPassword as any).mockResolvedValue(false)
    const response = await POST(loginRequest({ email: 'a@b.com', password: 'wrong' }))
    expect(response.status).toBe(401)
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

  it('returns 500 on an unexpected error', async () => {
    db.user.findUnique.mockRejectedValue(new Error('db down'))
    const response = await POST(loginRequest({ email: 'a@b.com', password: 'hunter2' }))
    expect(response.status).toBe(500)
  })
})
