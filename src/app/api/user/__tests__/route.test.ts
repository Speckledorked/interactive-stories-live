// src/app/api/user/__tests__/route.test.ts
// #93 — untested despite DELETE being irreversible account deletion,
// gated only by a typed confirmation string with no other safeguard.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
  },
}))

import { requireAuth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { GET, PATCH, DELETE } from '../route'

const db = prisma as any

function getRequest() {
  return new NextRequest('http://localhost/api/user')
}

function patchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/user', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function deleteRequest(body: unknown) {
  return new NextRequest('http://localhost/api/user', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(requireAuth as any).mockResolvedValue({ userId: 'user1', email: 'user1@example.com' })
})

describe('GET', () => {
  it('returns 401 when unauthenticated', async () => {
    ;(requireAuth as any).mockRejectedValue(new Error('Unauthorized'))
    const response = await GET(getRequest())
    expect(response.status).toBe(401)
  })

  it('404s when the token references a user that no longer exists', async () => {
    db.user.findUnique.mockResolvedValue(null)
    const response = await GET(getRequest())
    expect(response.status).toBe(404)
  })

  it('returns the current user', async () => {
    db.user.findUnique.mockResolvedValue({ id: 'user1', email: 'user1@example.com', name: 'Alex', createdAt: new Date() })
    const response = await GET(getRequest())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.user.id).toBe('user1')
  })
})

describe('PATCH', () => {
  it('rejects a non-string name', async () => {
    const response = await PATCH(patchRequest({ name: 42 }))
    expect(response.status).toBe(400)
    expect(db.user.update).not.toHaveBeenCalled()
  })

  it('rejects a name over 100 characters', async () => {
    const response = await PATCH(patchRequest({ name: 'x'.repeat(101) }))
    expect(response.status).toBe(400)
    expect(db.user.update).not.toHaveBeenCalled()
  })

  it('updates the name', async () => {
    db.user.update.mockResolvedValue({ id: 'user1', email: 'user1@example.com', name: 'Alex', createdAt: new Date() })
    const response = await PATCH(patchRequest({ name: 'Alex' }))
    expect(response.status).toBe(200)
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: 'user1' },
      data: { name: 'Alex' },
      select: { id: true, email: true, name: true, createdAt: true },
    })
  })

  it('clears the name to null on an empty string rather than storing an empty string', async () => {
    db.user.update.mockResolvedValue({ id: 'user1', email: 'user1@example.com', name: null, createdAt: new Date() })
    await PATCH(patchRequest({ name: '' }))
    expect(db.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: { name: null } }))
  })

  it('only updates a user that matches their own token, never another userId from the body', async () => {
    db.user.update.mockResolvedValue({ id: 'user1', email: 'user1@example.com', name: 'Alex', createdAt: new Date() })
    await PATCH(patchRequest({ name: 'Alex', userId: 'someone-elses-id' }))
    expect(db.user.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'user1' } }))
  })
})

describe('DELETE', () => {
  it('requires the exact confirmation phrase', async () => {
    const response = await DELETE(deleteRequest({ confirm: 'delete my account' }))
    expect(response.status).toBe(400)
    expect(db.user.delete).not.toHaveBeenCalled()
  })

  it('rejects a missing confirmation entirely', async () => {
    const response = await DELETE(deleteRequest({}))
    expect(response.status).toBe(400)
    expect(db.user.delete).not.toHaveBeenCalled()
  })

  it('deletes the account with the exact confirmation phrase', async () => {
    db.user.delete.mockResolvedValue({ id: 'user1' })
    const response = await DELETE(deleteRequest({ confirm: 'DELETE MY ACCOUNT' }))
    expect(response.status).toBe(200)
    expect(db.user.delete).toHaveBeenCalledWith({ where: { id: 'user1' } })
  })

  it('only ever deletes the authenticated user, not an id from the request body', async () => {
    db.user.delete.mockResolvedValue({ id: 'user1' })
    await DELETE(deleteRequest({ confirm: 'DELETE MY ACCOUNT', userId: 'someone-elses-id' }))
    expect(db.user.delete).toHaveBeenCalledWith({ where: { id: 'user1' } })
  })
})
