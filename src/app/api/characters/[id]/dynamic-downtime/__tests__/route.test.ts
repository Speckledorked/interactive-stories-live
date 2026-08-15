// src/app/api/characters/[id]/dynamic-downtime/__tests__/route.test.ts
// #135 (cont.) — the dynamic downtime route had no test coverage: the
// auth gate, moderation blocking a flagged activity description before
// it ever reaches the AI, and the rate limit on both the AI-calling POST
// and PUT, were all unverified.
//
// Follow-up: GET/POST/PUT previously verified only that the caller was
// authenticated, never that they owned `characterId` — any authenticated
// user could read, create dynamic activities for, or advance time on any
// character's downtime. Now gated by requireCharacterOwner; see the
// "rejects a character that belongs to someone else" cases below.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ verifyAuth: vi.fn() }))
vi.mock('@/lib/db/characterAccess', () => ({ requireCharacterOwner: vi.fn() }))
vi.mock('@/lib/rateLimit', () => ({
  AI_ACTION_LIMIT: { bucket: 'ai-action', limit: 20, windowSeconds: 60 },
  checkRateLimit: vi.fn(),
  rateLimitExceededResponse: vi.fn(),
}))
vi.mock('@/lib/ai/moderation', () => ({ moderatePlayerText: vi.fn() }))
vi.mock('@/lib/downtime/ai-downtime-service', () => ({
  AIDrivenDowntimeService: { createDynamicActivity: vi.fn(), advanceDynamicDowntime: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({
  prisma: { downtimeActivity: { findMany: vi.fn() } },
}))

import { verifyAuth } from '@/lib/auth'
import { requireCharacterOwner } from '@/lib/db/characterAccess'
import { checkRateLimit, rateLimitExceededResponse } from '@/lib/rateLimit'
import { moderatePlayerText } from '@/lib/ai/moderation'
import { AIDrivenDowntimeService } from '@/lib/downtime/ai-downtime-service'
import { prisma } from '@/lib/prisma'
import { GET, POST, PUT } from '../route'

const db = prisma as any

function getRequest(query = '') {
  return new NextRequest(`http://localhost/api/characters/char1/dynamic-downtime${query}`)
}

function postRequest(body: unknown) {
  return new NextRequest('http://localhost/api/characters/char1/dynamic-downtime', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function putRequest(body: unknown) {
  return new NextRequest('http://localhost/api/characters/char1/dynamic-downtime', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(verifyAuth as any).mockResolvedValue({ userId: 'player1' })
  ;(requireCharacterOwner as any).mockResolvedValue({ character: { id: 'char1', userId: 'player1' } })
  ;(checkRateLimit as any).mockResolvedValue({ allowed: true })
  ;(moderatePlayerText as any).mockResolvedValue({ flagged: false })
  db.downtimeActivity.findMany.mockResolvedValue([])
})

describe('GET', () => {
  it('rejects an unauthenticated request', async () => {
    ;(verifyAuth as any).mockResolvedValue(null)
    const response = await GET(getRequest(), { params: { id: 'char1' } })
    expect(response.status).toBe(401)
  })

  it('rejects a character that belongs to someone else', async () => {
    ;(requireCharacterOwner as any).mockResolvedValue({ response: new Response(null, { status: 403 }) })
    const response = await GET(getRequest(), { params: { id: 'char1' } })
    expect(response.status).toBe(403)
    expect(db.downtimeActivity.findMany).not.toHaveBeenCalled()
  })

  it('excludes completed activities by default', async () => {
    await GET(getRequest(), { params: { id: 'char1' } })
    expect(db.downtimeActivity.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { characterId: 'char1', status: { not: 'COMPLETED' } },
    }))
  })

  it('includes completed activities when requested', async () => {
    await GET(getRequest('?includeCompleted=true'), { params: { id: 'char1' } })
    expect(db.downtimeActivity.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { characterId: 'char1' },
    }))
  })
})

describe('POST', () => {
  it('rejects an unauthenticated request', async () => {
    ;(verifyAuth as any).mockResolvedValue(null)
    const response = await POST(postRequest({ description: 'Go fishing' }), { params: { id: 'char1' } })
    expect(response.status).toBe(401)
  })

  it('rejects an empty description', async () => {
    const response = await POST(postRequest({ description: '' }), { params: { id: 'char1' } })
    expect(response.status).toBe(400)
  })

  it('rejects a character that belongs to someone else, before rate limit or moderation', async () => {
    ;(requireCharacterOwner as any).mockResolvedValue({ response: new Response(null, { status: 403 }) })
    const response = await POST(postRequest({ description: 'Go fishing' }), { params: { id: 'char1' } })
    expect(response.status).toBe(403)
    expect(checkRateLimit).not.toHaveBeenCalled()
    expect(AIDrivenDowntimeService.createDynamicActivity).not.toHaveBeenCalled()
  })

  it('is rate limited before ever calling moderation', async () => {
    ;(checkRateLimit as any).mockResolvedValue({ allowed: false })
    ;(rateLimitExceededResponse as any).mockReturnValue(new Response(null, { status: 429 }))
    const response = await POST(postRequest({ description: 'Go fishing' }), { params: { id: 'char1' } })
    expect(response.status).toBe(429)
    expect(moderatePlayerText).not.toHaveBeenCalled()
  })

  it('blocks a flagged description before it reaches the AI', async () => {
    ;(moderatePlayerText as any).mockResolvedValue({ flagged: true, categories: ['violence'] })
    const response = await POST(postRequest({ description: 'bad text' }), { params: { id: 'char1' } })
    expect(response.status).toBe(400)
    expect(AIDrivenDowntimeService.createDynamicActivity).not.toHaveBeenCalled()
  })

  // #274: a moderation outage must fail closed, not silently let the
  // description through as if it had been checked and found clean.
  it('#274: fails closed with a 503 when the moderation check itself is unavailable', async () => {
    ;(moderatePlayerText as any).mockResolvedValue({ flagged: true, categories: [], unavailable: true })
    const response = await POST(postRequest({ description: 'anything' }), { params: { id: 'char1' } })
    expect(response.status).toBe(503)
    expect(AIDrivenDowntimeService.createDynamicActivity).not.toHaveBeenCalled()
  })

  it('creates the activity for clean input', async () => {
    ;(AIDrivenDowntimeService.createDynamicActivity as any).mockResolvedValue({ id: 'a1' })
    const response = await POST(postRequest({ description: 'Go fishing' }), { params: { id: 'char1' } })
    const body = await response.json()
    expect(response.status).toBe(201)
    expect(body).toEqual({ success: true, activity: { id: 'a1' } })
  })
})

describe('PUT', () => {
  it('rejects an unauthenticated request', async () => {
    ;(verifyAuth as any).mockResolvedValue(null)
    const response = await PUT(putRequest({ days: 1 }), { params: { id: 'char1' } })
    expect(response.status).toBe(401)
  })

  it('rejects days outside 1-30', async () => {
    const response = await PUT(putRequest({ days: 0 }), { params: { id: 'char1' } })
    expect(response.status).toBe(400)
  })

  it('rejects a character that belongs to someone else', async () => {
    ;(requireCharacterOwner as any).mockResolvedValue({ response: new Response(null, { status: 403 }) })
    const response = await PUT(putRequest({ days: 3 }), { params: { id: 'char1' } })
    expect(response.status).toBe(403)
    expect(AIDrivenDowntimeService.advanceDynamicDowntime).not.toHaveBeenCalled()
  })

  it('is rate limited', async () => {
    ;(checkRateLimit as any).mockResolvedValue({ allowed: false })
    ;(rateLimitExceededResponse as any).mockReturnValue(new Response(null, { status: 429 }))
    const response = await PUT(putRequest({ days: 3 }), { params: { id: 'char1' } })
    expect(response.status).toBe(429)
  })

  it('advances time by the requested number of days', async () => {
    ;(AIDrivenDowntimeService.advanceDynamicDowntime as any).mockResolvedValue([{ day: 1 }])
    const response = await PUT(putRequest({ days: 3 }), { params: { id: 'char1' } })
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body).toEqual({ success: true, daysAdvanced: 3, results: [{ day: 1 }] })
    expect(AIDrivenDowntimeService.advanceDynamicDowntime).toHaveBeenCalledWith('char1', 3)
  })
})
