// src/app/api/notifications/[id]/__tests__/route.test.ts
// #135 (cont.) — reading/updating/deleting a single notification had no
// test coverage: GET's linear scan being scoped to the caller's OWN
// notifications (so it can't be used to peek at someone else's by id),
// and PUT/DELETE's not-found-or-not-yours "not found" response, were both
// unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ verifyAuth: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { notification: { deleteMany: vi.fn() } },
}))
vi.mock('@/lib/notifications/notification-service', () => ({
  NotificationService: { getNotifications: vi.fn(), markAsRead: vi.fn(), dismiss: vi.fn() },
}))

import { verifyAuth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { NotificationService } from '@/lib/notifications/notification-service'
import { GET, PUT, DELETE } from '../route'

const db = prisma as any

function getRequest() {
  return new NextRequest('http://localhost/api/notifications/n1')
}

function putRequest(body: unknown) {
  return new NextRequest('http://localhost/api/notifications/n1', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function deleteRequest() {
  return new NextRequest('http://localhost/api/notifications/n1', { method: 'DELETE' })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(verifyAuth as any).mockResolvedValue({ userId: 'user1' })
})

describe('GET', () => {
  it('rejects an unauthenticated request', async () => {
    ;(verifyAuth as any).mockResolvedValue(null)
    const response = await GET(getRequest(), { params: { id: 'n1' } })
    expect(response.status).toBe(401)
  })

  it('404s when the id is not among the caller\'s own notifications', async () => {
    ;(NotificationService.getNotifications as any).mockResolvedValue([{ id: 'someone-elses' }])
    const response = await GET(getRequest(), { params: { id: 'n1' } })
    expect(response.status).toBe(404)
  })

  it('returns the notification when it belongs to the caller', async () => {
    ;(NotificationService.getNotifications as any).mockResolvedValue([{ id: 'n1', title: 'Hi' }])
    const response = await GET(getRequest(), { params: { id: 'n1' } })
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.id).toBe('n1')
  })
})

describe('PUT', () => {
  it('rejects an unauthenticated request', async () => {
    ;(verifyAuth as any).mockResolvedValue(null)
    const response = await PUT(putRequest({ action: 'read' }), { params: { id: 'n1' } })
    expect(response.status).toBe(401)
  })

  it('rejects an invalid action', async () => {
    const response = await PUT(putRequest({ action: 'archive' }), { params: { id: 'n1' } })
    expect(response.status).toBe(400)
    expect(NotificationService.markAsRead).not.toHaveBeenCalled()
  })

  it('404s when nothing matched (not found, or not the caller\'s)', async () => {
    ;(NotificationService.markAsRead as any).mockResolvedValue({ count: 0 })
    const response = await PUT(putRequest({ action: 'read' }), { params: { id: 'n1' } })
    expect(response.status).toBe(404)
  })

  it('marks the notification read', async () => {
    ;(NotificationService.markAsRead as any).mockResolvedValue({ count: 1 })
    const response = await PUT(putRequest({ action: 'read' }), { params: { id: 'n1' } })
    expect(response.status).toBe(200)
    expect(NotificationService.markAsRead).toHaveBeenCalledWith('n1', 'user1')
  })

  it('dismisses the notification', async () => {
    ;(NotificationService.dismiss as any).mockResolvedValue({ count: 1 })
    const response = await PUT(putRequest({ action: 'dismiss' }), { params: { id: 'n1' } })
    expect(response.status).toBe(200)
    expect(NotificationService.dismiss).toHaveBeenCalledWith('n1', 'user1')
  })
})

describe('DELETE', () => {
  it('rejects an unauthenticated request', async () => {
    ;(verifyAuth as any).mockResolvedValue(null)
    const response = await DELETE(deleteRequest(), { params: { id: 'n1' } })
    expect(response.status).toBe(401)
  })

  it('404s when nothing matched (not found, or not the caller\'s)', async () => {
    db.notification.deleteMany.mockResolvedValue({ count: 0 })
    const response = await DELETE(deleteRequest(), { params: { id: 'n1' } })
    expect(response.status).toBe(404)
  })

  it('deletes the notification, scoped to the caller', async () => {
    db.notification.deleteMany.mockResolvedValue({ count: 1 })
    const response = await DELETE(deleteRequest(), { params: { id: 'n1' } })
    expect(response.status).toBe(200)
    expect(db.notification.deleteMany).toHaveBeenCalledWith({ where: { id: 'n1', userId: 'user1' } })
  })
})
