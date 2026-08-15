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
vi.mock('@/lib/rateLimit', () => ({
  FRIEND_SEARCH_LIMIT: { bucket: 'friend-search', limit: 20, windowSeconds: 60 },
  checkRateLimit: vi.fn(),
  rateLimitExceededResponse: vi.fn(),
}))

import { getUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkRateLimit, rateLimitExceededResponse } from '@/lib/rateLimit'
import { GET } from '../route'

const db = prisma as any

function req(query: string) {
  return new NextRequest(`http://localhost/api/friends/search?q=${query}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getUser as any).mockResolvedValue({ userId: 'me' })
  ;(checkRateLimit as any).mockResolvedValue({ allowed: true, remaining: 19, retryAfterSeconds: 0 })
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

  // #316: search returns full emails/names for up to 10 users per call
  // with zero rate limiting — exactly the shape a script enumerates the
  // user base with.
  it('#316: rejects a request over the rate limit before searching', async () => {
    ;(checkRateLimit as any).mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 30 })
    ;(rateLimitExceededResponse as any).mockReturnValue(new Response(null, { status: 429 }))
    const response = await GET(req('alice'))
    expect(response.status).toBe(429)
    expect(db.user.findMany).not.toHaveBeenCalled()
  })

  it('#316: keys the rate limit on the authenticated user', async () => {
    db.user.findMany.mockResolvedValue([])
    await GET(req('alice'))
    expect(checkRateLimit).toHaveBeenCalledWith('me', 'friend-search', 20, 60)
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
