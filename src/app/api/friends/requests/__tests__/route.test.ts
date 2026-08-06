// src/app/api/friends/requests/__tests__/route.test.ts
// #135 (cont.) — sending/listing friend requests had no test coverage:
// the auth gate, the incoming/outgoing/all filter branching, the
// can't-friend-yourself guard, the already-friends guard, and the
// already-pending-in-EITHER-direction guard (a duplicate request from
// the other side must also be caught, not just an exact resend), were
// all unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ getUser: vi.fn() }))
vi.mock('@/lib/notifications/notification-service', () => ({
  notificationService: { sendFriendRequest: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    friendRequest: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    friendship: { findFirst: vi.fn() },
    user: { findMany: vi.fn(), findUnique: vi.fn() },
  },
}))

import { getUser } from '@/lib/auth'
import { notificationService } from '@/lib/notifications/notification-service'
import { prisma } from '@/lib/prisma'
import { GET, POST } from '../route'

const db = prisma as any

function getRequest(query = '') {
  return new NextRequest(`http://localhost/api/friends/requests${query}`)
}

function postRequest(body: unknown) {
  return new NextRequest('http://localhost/api/friends/requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getUser as any).mockResolvedValue({ userId: 'u1' })
  db.friendRequest.findMany.mockResolvedValue([])
  db.user.findMany.mockResolvedValue([])
  db.friendship.findFirst.mockResolvedValue(null)
  db.friendRequest.findFirst.mockResolvedValue(null)
  db.user.findUnique.mockResolvedValue({ name: 'U1', email: 'u1@example.com' })
})

describe('GET', () => {
  it('rejects an unauthenticated request', async () => {
    ;(getUser as any).mockResolvedValue(null)
    const response = await GET(getRequest())
    expect(response.status).toBe(401)
  })

  it('filters to incoming pending requests', async () => {
    await GET(getRequest('?type=incoming'))
    expect(db.friendRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { receiverId: 'u1', status: 'PENDING' },
    }))
  })

  it('filters to outgoing pending requests', async () => {
    await GET(getRequest('?type=outgoing'))
    expect(db.friendRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { senderId: 'u1', status: 'PENDING' },
    }))
  })

  it('defaults to both directions, any status', async () => {
    await GET(getRequest())
    expect(db.friendRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { OR: [{ receiverId: 'u1' }, { senderId: 'u1' }] },
    }))
  })
})

describe('POST', () => {
  it('rejects an unauthenticated request', async () => {
    ;(getUser as any).mockResolvedValue(null)
    const response = await POST(postRequest({ receiverId: 'u2' }))
    expect(response.status).toBe(401)
  })

  it('requires a receiverId', async () => {
    const response = await POST(postRequest({}))
    expect(response.status).toBe(400)
  })

  it('rejects sending a request to yourself', async () => {
    const response = await POST(postRequest({ receiverId: 'u1' }))
    expect(response.status).toBe(400)
    expect(db.friendRequest.create).not.toHaveBeenCalled()
  })

  it('rejects when already friends', async () => {
    db.friendship.findFirst.mockResolvedValue({ user1Id: 'u1', user2Id: 'u2' })
    const response = await POST(postRequest({ receiverId: 'u2' }))
    expect(response.status).toBe(400)
    expect(db.friendRequest.create).not.toHaveBeenCalled()
  })

  it('rejects a duplicate pending request from the OTHER direction too', async () => {
    db.friendRequest.findFirst.mockResolvedValue({ senderId: 'u2', receiverId: 'u1', status: 'PENDING' })
    const response = await POST(postRequest({ receiverId: 'u2' }))
    expect(response.status).toBe(400)
    expect(db.friendRequest.create).not.toHaveBeenCalled()
  })

  it('creates the request and notifies the receiver', async () => {
    db.friendRequest.create.mockResolvedValue({ id: 'r1', senderId: 'u1', receiverId: 'u2' })
    const response = await POST(postRequest({ receiverId: 'u2', message: 'hi' }))
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.friendRequest).toEqual({ id: 'r1', senderId: 'u1', receiverId: 'u2' })
    expect(notificationService.sendFriendRequest).toHaveBeenCalledWith('u2', 'u1', 'U1')
  })
})
