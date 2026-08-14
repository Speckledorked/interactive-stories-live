// src/app/api/friends/__tests__/route.test.ts
// #135 (cont.) — the friends list/remove route had no test coverage: the
// auth gate on both verbs, that GET resolves the OTHER side of the
// friendship regardless of which column the caller happens to be stored
// in (user1Id vs. user2Id), and that DELETE removes the friendship
// regardless of that same ordering, were all unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ getUser: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    friendship: { findMany: vi.fn(), deleteMany: vi.fn() },
    friendRequest: { deleteMany: vi.fn() },
    user: { findMany: vi.fn() },
  },
}))

import { getUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { GET, DELETE } from '../route'

const db = prisma as any

function getRequest() {
  return new NextRequest('http://localhost/api/friends')
}

function deleteRequest(query = '') {
  return new NextRequest(`http://localhost/api/friends${query}`, { method: 'DELETE' })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getUser as any).mockResolvedValue({ userId: 'u1' })
  db.friendship.findMany.mockResolvedValue([])
  db.user.findMany.mockResolvedValue([])
})

describe('GET', () => {
  it('rejects an unauthenticated request', async () => {
    ;(getUser as any).mockResolvedValue(null)
    const response = await GET(getRequest())
    expect(response.status).toBe(401)
  })

  it('resolves the other side of the friendship regardless of column order', async () => {
    db.friendship.findMany.mockResolvedValue([
      { user1Id: 'u1', user2Id: 'friend1' },
      { user1Id: 'friend2', user2Id: 'u1' },
    ])
    await GET(getRequest())
    expect(db.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ['friend1', 'friend2'] } },
    }))
  })
})

describe('DELETE', () => {
  it('rejects an unauthenticated request', async () => {
    ;(getUser as any).mockResolvedValue(null)
    const response = await DELETE(deleteRequest('?friendId=f1'))
    expect(response.status).toBe(401)
  })

  it('requires a friendId', async () => {
    const response = await DELETE(deleteRequest())
    expect(response.status).toBe(400)
    expect(db.friendship.deleteMany).not.toHaveBeenCalled()
  })

  it('removes the friendship regardless of column order', async () => {
    const response = await DELETE(deleteRequest('?friendId=f1'))
    expect(response.status).toBe(200)
    expect(db.friendship.deleteMany).toHaveBeenCalledWith({
      where: { OR: [{ user1Id: 'u1', user2Id: 'f1' }, { user1Id: 'f1', user2Id: 'u1' }] },
    })
  })

  // #307: the FriendRequest that originally led to this friendship would
  // otherwise sit ACCEPTED forever — @@unique([senderId, receiverId]) has
  // no status scoping, so that stale row would permanently block a fresh
  // request in either direction after unfriending.
  it('#307: also cleans up the FriendRequest row in either direction', async () => {
    await DELETE(deleteRequest('?friendId=f1'))
    expect(db.friendRequest.deleteMany).toHaveBeenCalledWith({
      where: { OR: [{ senderId: 'u1', receiverId: 'f1' }, { senderId: 'f1', receiverId: 'u1' }] },
    })
  })
})
