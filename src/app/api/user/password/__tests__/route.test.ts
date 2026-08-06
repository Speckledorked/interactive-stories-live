// src/app/api/user/password/__tests__/route.test.ts
// #134 (cont.) — changing your own password (while logged in) had no test
// coverage: it requires the CURRENT password to be re-verified even for an
// authenticated caller, and must fail cleanly for an OAuth-only account
// (no password set at all) rather than throwing on a null compare.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { user: { findUnique: vi.fn(), update: vi.fn() } },
}))
vi.mock('@/lib/password', () => ({ hashPassword: vi.fn(), verifyPassword: vi.fn() }))

import { requireAuth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { hashPassword, verifyPassword } from '@/lib/password'
import { POST } from '../route'

const db = prisma as any

function req(body: unknown) {
  return new NextRequest('http://localhost/api/user/password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(requireAuth as any).mockResolvedValue({ userId: 'u1', email: 'u1@example.com' })
  ;(hashPassword as any).mockResolvedValue('new-hashed-password')
})

describe('POST /api/user/password', () => {
  it('rejects an unauthenticated request', async () => {
    ;(requireAuth as any).mockRejectedValue(new Error('Unauthorized'))
    const response = await POST(req({ currentPassword: 'old', newPassword: 'longenough' }))
    expect(response.status).toBe(401)
    expect(db.user.update).not.toHaveBeenCalled()
  })

  it('rejects a request missing either password field', async () => {
    const response = await POST(req({ currentPassword: 'old' }))
    expect(response.status).toBe(400)
  })

  it('rejects a new password shorter than 8 characters', async () => {
    const response = await POST(req({ currentPassword: 'old', newPassword: 'short' }))
    expect(response.status).toBe(400)
    expect(db.user.findUnique).not.toHaveBeenCalled()
  })

  it('404s if the user row is gone', async () => {
    db.user.findUnique.mockResolvedValue(null)
    const response = await POST(req({ currentPassword: 'old', newPassword: 'longenough' }))
    expect(response.status).toBe(404)
  })

  it('rejects for an OAuth-only account with no password set', async () => {
    db.user.findUnique.mockResolvedValue({ id: 'u1', password: null })
    const response = await POST(req({ currentPassword: 'old', newPassword: 'longenough' }))
    expect(response.status).toBe(400)
    expect(verifyPassword).not.toHaveBeenCalled()
  })

  it('rejects an incorrect current password', async () => {
    db.user.findUnique.mockResolvedValue({ id: 'u1', password: 'hashed-old' })
    ;(verifyPassword as any).mockResolvedValue(false)

    const response = await POST(req({ currentPassword: 'wrong', newPassword: 'longenough' }))

    expect(response.status).toBe(401)
    expect(db.user.update).not.toHaveBeenCalled()
  })

  it('updates the password when the current one checks out', async () => {
    db.user.findUnique.mockResolvedValue({ id: 'u1', password: 'hashed-old' })
    ;(verifyPassword as any).mockResolvedValue(true)
    db.user.update.mockResolvedValue({ id: 'u1' })

    const response = await POST(req({ currentPassword: 'old', newPassword: 'longenough' }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { password: 'new-hashed-password' },
    })
  })

  it('returns 500 on an unexpected error', async () => {
    db.user.findUnique.mockRejectedValue(new Error('db down'))
    const response = await POST(req({ currentPassword: 'old', newPassword: 'longenough' }))
    expect(response.status).toBe(500)
  })
})
