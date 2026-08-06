// src/app/api/notifications/push/__tests__/route.test.ts
// #135 (cont.) — browser push subscription management had no test
// coverage: the auth gate on all three verbs, that GET's
// `configured: false` reads as a normal deployment state, and the
// required body fields on POST/DELETE, were all unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ getUser: vi.fn() }))
vi.mock('@/lib/notifications/push-service', () => ({
  getVapidPublicKey: vi.fn(),
  savePushSubscription: vi.fn(),
  deletePushSubscription: vi.fn(),
}))

import { getUser } from '@/lib/auth'
import { getVapidPublicKey, savePushSubscription, deletePushSubscription } from '@/lib/notifications/push-service'
import { GET, POST, DELETE } from '../route'

function getRequest() {
  return new NextRequest('http://localhost/api/notifications/push')
}

function postRequest(body: unknown) {
  return new NextRequest('http://localhost/api/notifications/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function deleteRequest(body: unknown) {
  return new NextRequest('http://localhost/api/notifications/push', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getUser as any).mockResolvedValue({ userId: 'u1' })
})

describe('GET', () => {
  it('rejects an unauthenticated request', async () => {
    ;(getUser as any).mockResolvedValue(null)
    const response = await GET(getRequest())
    expect(response.status).toBe(401)
  })

  it('reports configured:false as a normal state when no VAPID key is set', async () => {
    ;(getVapidPublicKey as any).mockReturnValue(null)
    const response = await GET(getRequest())
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body).toEqual({ configured: false, publicKey: null })
  })

  it('reports configured:true with the public key when set', async () => {
    ;(getVapidPublicKey as any).mockReturnValue('vapid-key')
    const response = await GET(getRequest())
    const body = await response.json()
    expect(body).toEqual({ configured: true, publicKey: 'vapid-key' })
  })
})

describe('POST', () => {
  it('rejects an unauthenticated request', async () => {
    ;(getUser as any).mockResolvedValue(null)
    const response = await POST(postRequest({ endpoint: 'e', keys: { p256dh: 'p', auth: 'a' } }))
    expect(response.status).toBe(401)
  })

  it('requires endpoint and keys', async () => {
    const response = await POST(postRequest({ endpoint: 'e' }))
    expect(response.status).toBe(400)
    expect(savePushSubscription).not.toHaveBeenCalled()
  })

  it('saves a well-formed subscription', async () => {
    const response = await POST(postRequest({ endpoint: 'e', keys: { p256dh: 'p', auth: 'a' } }))
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body).toEqual({ success: true })
    expect(savePushSubscription).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'u1', endpoint: 'e', p256dh: 'p', auth: 'a',
    }))
  })
})

describe('DELETE', () => {
  it('rejects an unauthenticated request', async () => {
    ;(getUser as any).mockResolvedValue(null)
    const response = await DELETE(deleteRequest({ endpoint: 'e' }))
    expect(response.status).toBe(401)
  })

  it('requires endpoint', async () => {
    const response = await DELETE(deleteRequest({}))
    expect(response.status).toBe(400)
    expect(deletePushSubscription).not.toHaveBeenCalled()
  })

  it('deletes the subscription', async () => {
    const response = await DELETE(deleteRequest({ endpoint: 'e' }))
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body).toEqual({ success: true })
    expect(deletePushSubscription).toHaveBeenCalledWith('u1', 'e')
  })
})
