// src/app/api/friends/requests/[requestId]/__tests__/route.test.ts
// #133 — friend-request accept/reject (PATCH) and cancel (DELETE) had no
// test coverage: the receiver-only/sender-only ownership gates and the
// already-responded/not-pending guards were both unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ getUser: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    friendRequest: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    friendship: { create: vi.fn() },
    user: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}))
vi.mock('@/lib/notifications/notification-service', () => ({
  notificationService: { sendFriendRequestAccepted: vi.fn() },
}))

import { getUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { notificationService } from '@/lib/notifications/notification-service'
import { PATCH, DELETE } from '../route'

const db = prisma as any

function patchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/friends/requests/req1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function deleteRequest() {
  return new NextRequest('http://localhost/api/friends/requests/req1', { method: 'DELETE' })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getUser as any).mockResolvedValue({ userId: 'receiver1', email: 'receiver1@example.com' })
  db.user.findUnique.mockResolvedValue({ name: 'Receiver', email: 'receiver1@example.com' })
})

describe('PATCH', () => {
  it('rejects an unauthenticated request', async () => {
    ;(getUser as any).mockResolvedValue(null)
    const response = await PATCH(patchRequest({ action: 'accept' }), { params: { requestId: 'req1' } })
    expect(response.status).toBe(401)
  })

  it('rejects an invalid action', async () => {
    const response = await PATCH(patchRequest({ action: 'maybe' }), { params: { requestId: 'req1' } })
    expect(response.status).toBe(400)
    expect(db.friendRequest.findUnique).not.toHaveBeenCalled()
  })

  it('404s when the request does not exist', async () => {
    db.friendRequest.findUnique.mockResolvedValue(null)
    const response = await PATCH(patchRequest({ action: 'accept' }), { params: { requestId: 'req1' } })
    expect(response.status).toBe(404)
  })

  it('rejects anyone but the receiver', async () => {
    db.friendRequest.findUnique.mockResolvedValue({ id: 'req1', senderId: 'sender1', receiverId: 'someone-else', status: 'PENDING' })
    const response = await PATCH(patchRequest({ action: 'accept' }), { params: { requestId: 'req1' } })
    expect(response.status).toBe(403)
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it('rejects responding to an already-resolved request', async () => {
    db.friendRequest.findUnique.mockResolvedValue({ id: 'req1', senderId: 'sender1', receiverId: 'receiver1', status: 'ACCEPTED' })
    const response = await PATCH(patchRequest({ action: 'accept' }), { params: { requestId: 'req1' } })
    expect(response.status).toBe(400)
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it('accepts the request, creates a friendship, and notifies the sender', async () => {
    db.friendRequest.findUnique.mockResolvedValue({ id: 'req1', senderId: 'sender1', receiverId: 'receiver1', status: 'PENDING' })
    db.$transaction.mockResolvedValue([{ id: 'friendship1', user1Id: 'receiver1', user2Id: 'sender1' }])

    const response = await PATCH(patchRequest({ action: 'accept' }), { params: { requestId: 'req1' } })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.friendship).toEqual({ id: 'friendship1', user1Id: 'receiver1', user2Id: 'sender1' })
    expect(notificationService.sendFriendRequestAccepted).toHaveBeenCalledWith('sender1', 'receiver1', 'Receiver')
  })

  it('rejects the request without creating a friendship or notifying anyone', async () => {
    db.friendRequest.findUnique.mockResolvedValue({ id: 'req1', senderId: 'sender1', receiverId: 'receiver1', status: 'PENDING' })
    db.friendRequest.update.mockResolvedValue({ id: 'req1', status: 'REJECTED' })

    const response = await PATCH(patchRequest({ action: 'reject' }), { params: { requestId: 'req1' } })

    expect(response.status).toBe(200)
    expect(db.friendRequest.update).toHaveBeenCalledWith({
      where: { id: 'req1' },
      data: expect.objectContaining({ status: 'REJECTED' }),
    })
    expect(db.$transaction).not.toHaveBeenCalled()
    expect(notificationService.sendFriendRequestAccepted).not.toHaveBeenCalled()
  })
})

describe('DELETE', () => {
  it('rejects an unauthenticated request', async () => {
    ;(getUser as any).mockResolvedValue(null)
    const response = await DELETE(deleteRequest(), { params: { requestId: 'req1' } })
    expect(response.status).toBe(401)
  })

  it('404s when the request does not exist', async () => {
    db.friendRequest.findUnique.mockResolvedValue(null)
    const response = await DELETE(deleteRequest(), { params: { requestId: 'req1' } })
    expect(response.status).toBe(404)
  })

  it('rejects anyone but the sender', async () => {
    ;(getUser as any).mockResolvedValue({ userId: 'someone-else', email: 'x@example.com' })
    db.friendRequest.findUnique.mockResolvedValue({ id: 'req1', senderId: 'sender1', receiverId: 'receiver1', status: 'PENDING' })
    const response = await DELETE(deleteRequest(), { params: { requestId: 'req1' } })
    expect(response.status).toBe(403)
    expect(db.friendRequest.delete).not.toHaveBeenCalled()
  })

  it('rejects cancelling a request that already got a response', async () => {
    ;(getUser as any).mockResolvedValue({ userId: 'sender1', email: 'x@example.com' })
    db.friendRequest.findUnique.mockResolvedValue({ id: 'req1', senderId: 'sender1', receiverId: 'receiver1', status: 'ACCEPTED' })
    const response = await DELETE(deleteRequest(), { params: { requestId: 'req1' } })
    expect(response.status).toBe(400)
    expect(db.friendRequest.delete).not.toHaveBeenCalled()
  })

  it('lets the sender cancel a still-pending request', async () => {
    ;(getUser as any).mockResolvedValue({ userId: 'sender1', email: 'x@example.com' })
    db.friendRequest.findUnique.mockResolvedValue({ id: 'req1', senderId: 'sender1', receiverId: 'receiver1', status: 'PENDING' })
    db.friendRequest.delete.mockResolvedValue({ id: 'req1' })

    const response = await DELETE(deleteRequest(), { params: { requestId: 'req1' } })

    expect(response.status).toBe(200)
    expect(db.friendRequest.delete).toHaveBeenCalledWith({ where: { id: 'req1' } })
  })
})
