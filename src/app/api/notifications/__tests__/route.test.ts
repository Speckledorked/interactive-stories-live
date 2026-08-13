// src/app/api/notifications/__tests__/route.test.ts
// #135 (cont.) — listing, creating (dev-only), and bulk-clearing
// notifications had no test coverage: the type-filter applied on top of
// the service call, and POST's production-environment lockout, were both
// unverified.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ verifyAuth: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { notification: { deleteMany: vi.fn() } },
}))
vi.mock('@/lib/notifications/notification-service', () => ({
  NotificationService: { getNotifications: vi.fn(), createNotification: vi.fn() },
}))

import { verifyAuth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { NotificationService } from '@/lib/notifications/notification-service'
import { GET, POST, DELETE } from '../route'

const db = prisma as any
const originalNodeEnv = process.env.NODE_ENV

function getRequest(query = '') {
  return new NextRequest(`http://localhost/api/notifications${query}`)
}

function postRequest(body: unknown) {
  return new NextRequest('http://localhost/api/notifications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function deleteRequest(query = '') {
  return new NextRequest(`http://localhost/api/notifications${query}`, { method: 'DELETE' })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(verifyAuth as any).mockResolvedValue({ userId: 'user1' })
})

afterEach(() => {
  vi.stubEnv('NODE_ENV', originalNodeEnv as string)
})

describe('GET', () => {
  it('rejects an unauthenticated request', async () => {
    ;(verifyAuth as any).mockResolvedValue(null)
    const response = await GET(getRequest())
    expect(response.status).toBe(401)
  })

  it('filters the service result by type client-side', async () => {
    ;(NotificationService.getNotifications as any).mockResolvedValue([
      { id: 'n1', type: 'TURN_REMINDER' },
      { id: 'n2', type: 'CAMPAIGN_INVITE' },
    ])

    const response = await GET(getRequest('?type=CAMPAIGN_INVITE'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.notifications).toEqual([{ id: 'n2', type: 'CAMPAIGN_INVITE' }])
  })

  it('reports hasMore when the page came back full', async () => {
    ;(NotificationService.getNotifications as any).mockResolvedValue(Array.from({ length: 20 }, (_, i) => ({ id: `n${i}` })))
    const response = await GET(getRequest('?limit=20'))
    const body = await response.json()
    expect(body.hasMore).toBe(true)
  })
})

describe('POST', () => {
  it('rejects an unauthenticated request', async () => {
    ;(verifyAuth as any).mockResolvedValue(null)
    const response = await POST(postRequest({}))
    expect(response.status).toBe(401)
  })

  it('is blocked in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const response = await POST(postRequest({}))
    const body = await response.json()
    expect(response.status).toBe(403)
    expect(body.error).toBe('Not allowed in production')
    expect(NotificationService.createNotification).not.toHaveBeenCalled()
  })

  it('creates a test notification outside production', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    ;(NotificationService.createNotification as any).mockResolvedValue({ id: 'n1' })

    const response = await POST(postRequest({ title: 'Custom title' }))

    expect(response.status).toBe(200)
    expect(NotificationService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user1', title: 'Custom title', type: 'TURN_REMINDER' })
    )
  })
})

describe('DELETE', () => {
  it('rejects an unauthenticated request', async () => {
    ;(verifyAuth as any).mockResolvedValue(null)
    const response = await DELETE(deleteRequest())
    expect(response.status).toBe(401)
  })

  it('only clears read/dismissed notifications for the caller', async () => {
    db.notification.deleteMany.mockResolvedValue({ count: 3 })
    const response = await DELETE(deleteRequest())
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.message).toContain('3')
    expect(db.notification.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user1', status: { in: ['READ', 'DISMISSED'] } },
    })
  })

  it('scopes to a campaign when one is given', async () => {
    db.notification.deleteMany.mockResolvedValue({ count: 1 })
    await DELETE(deleteRequest('?campaignId=camp1'))
    expect(db.notification.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user1', status: { in: ['READ', 'DISMISSED'] }, campaignId: 'camp1' },
    })
  })
})
