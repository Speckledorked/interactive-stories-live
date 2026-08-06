// src/app/api/friends/search/__tests__/route.test.ts
// #135 (cont.) — friend search had no test coverage: excluding the caller
// from their own results, the minimum-query-length guard, and the
// friend/pending-request enrichment (including which direction a pending
// request runs) were all unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ getUser: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findMany: vi.fn() },
    friendship: { findMany: vi.fn() },
    friendRequest: { findMany: vi.fn() },
  },
}))

import { getUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { GET } from '../route'

const db = prisma as any

function req(query: string) {
  return new NextRequest(`http://localhost/api/friends/search?q=${query}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getUser as any).mockResolvedValue({ userId: 'me' })
  db.friendship.findMany.mockResolvedValue([])
  db.friendRequest.findMany.mockResolvedValue([])
})

describe('GET', () => {
  it('rejects an unauthenticated request', async () => {
    ;(getUser as any).mockResolvedValue(null)
    const response = await GET(req('ali'))
    expect(response.status).toBe(401)
  })

  it('rejects a query shorter than 2 characters', async () => {
    const response = await GET(req('a'))
    expect(response.status).toBe(400)
    expect(db.user.findMany).not.toHaveBeenCalled()
  })

  it('excludes the caller from their own search results', async () => {
    db.user.findMany.mockResolvedValue([])
    await GET(req('alice'))
    expect(db.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ AND: expect.arrayContaining([{ id: { not: 'me' } }]) }),
    }))
  })

  it('marks an already-friended result as a friend', async () => {
    db.user.findMany.mockResolvedValue([{ id: 'u1', email: 'a@b.com', name: 'Alice', isOnline: true }])
    db.friendship.findMany.mockResolvedValue([{ user1Id: 'me', user2Id: 'u1' }])

    const response = await GET(req('alice'))
    const body = await response.json()

    expect(body.users[0].isFriend).toBe(true)
    expect(body.users[0].friendRequest).toBeNull()
  })

  it('marks an outgoing pending request', async () => {
    db.user.findMany.mockResolvedValue([{ id: 'u1', email: 'a@b.com', name: 'Alice', isOnline: false }])
    db.friendRequest.findMany.mockResolvedValue([{ id: 'req1', senderId: 'me', receiverId: 'u1', status: 'PENDING' }])

    const response = await GET(req('alice'))
    const body = await response.json()

    expect(body.users[0].isFriend).toBe(false)
    expect(body.users[0].friendRequest).toEqual({ id: 'req1', type: 'outgoing' })
  })

  it('marks an incoming pending request', async () => {
    db.user.findMany.mockResolvedValue([{ id: 'u1', email: 'a@b.com', name: 'Alice', isOnline: false }])
    db.friendRequest.findMany.mockResolvedValue([{ id: 'req1', senderId: 'u1', receiverId: 'me', status: 'PENDING' }])

    const response = await GET(req('alice'))
    const body = await response.json()

    expect(body.users[0].friendRequest).toEqual({ id: 'req1', type: 'incoming' })
  })

  it('returns 500 on an unexpected error', async () => {
    db.user.findMany.mockRejectedValue(new Error('db down'))
    const response = await GET(req('alice'))
    expect(response.status).toBe(500)
  })
})
