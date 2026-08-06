// src/app/api/notifications/settings/__tests__/route.test.ts
// #135 (cont.) — notification preferences had no test coverage: GET's
// create-defaults-if-missing fallback, PUT's field allowlist (unknown
// fields must be dropped, not persisted), and the quiet-hours HH:MM format
// validation were all unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ verifyAuth: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { userNotificationSettings: { findUnique: vi.fn(), create: vi.fn(), upsert: vi.fn() } },
}))

import { verifyAuth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { GET, PUT } from '../route'

const db = prisma as any

function getRequest() {
  return new NextRequest('http://localhost/api/notifications/settings')
}

function putRequest(body: unknown) {
  return new NextRequest('http://localhost/api/notifications/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(verifyAuth as any).mockResolvedValue({ userId: 'user1' })
})

describe('GET', () => {
  it('rejects an unauthenticated request', async () => {
    ;(verifyAuth as any).mockResolvedValue(null)
    const response = await GET(getRequest())
    expect(response.status).toBe(401)
  })

  it('returns existing settings without creating a new row', async () => {
    db.userNotificationSettings.findUnique.mockResolvedValue({ userId: 'user1', emailEnabled: false })
    const response = await GET(getRequest())
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.emailEnabled).toBe(false)
    expect(db.userNotificationSettings.create).not.toHaveBeenCalled()
  })

  it('creates default settings on first access', async () => {
    db.userNotificationSettings.findUnique.mockResolvedValue(null)
    db.userNotificationSettings.create.mockResolvedValue({ userId: 'user1', emailEnabled: true })
    const response = await GET(getRequest())
    expect(response.status).toBe(200)
    expect(db.userNotificationSettings.create).toHaveBeenCalledWith({ data: { userId: 'user1' } })
  })
})

describe('PUT', () => {
  it('rejects an unauthenticated request', async () => {
    ;(verifyAuth as any).mockResolvedValue(null)
    const response = await PUT(putRequest({ emailEnabled: false }))
    expect(response.status).toBe(401)
  })

  it('drops fields not on the allowlist', async () => {
    db.userNotificationSettings.upsert.mockResolvedValue({ userId: 'user1' })
    await PUT(putRequest({ emailEnabled: true, userId: 'attacker-id', isAdmin: true }))
    expect(db.userNotificationSettings.upsert).toHaveBeenCalledWith({
      where: { userId: 'user1' },
      update: { emailEnabled: true },
      create: { userId: 'user1', emailEnabled: true },
    })
  })

  it('rejects an invalid quietHoursStart format', async () => {
    const response = await PUT(putRequest({ quietHoursStart: '25:99' }))
    expect(response.status).toBe(400)
    expect(db.userNotificationSettings.upsert).not.toHaveBeenCalled()
  })

  it('rejects an invalid quietHoursEnd format', async () => {
    const response = await PUT(putRequest({ quietHoursEnd: 'not-a-time' }))
    expect(response.status).toBe(400)
  })

  it('accepts a valid quiet-hours range', async () => {
    db.userNotificationSettings.upsert.mockResolvedValue({ userId: 'user1' })
    const response = await PUT(putRequest({ quietHoursStart: '22:00', quietHoursEnd: '07:30' }))
    expect(response.status).toBe(200)
  })

  it('returns 500 on an unexpected error', async () => {
    db.userNotificationSettings.upsert.mockRejectedValue(new Error('db down'))
    const response = await PUT(putRequest({ emailEnabled: true }))
    expect(response.status).toBe(500)
  })
})
