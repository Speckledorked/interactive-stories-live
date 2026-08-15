// src/app/api/dynamic-downtime-events/[id]/respond/__tests__/route.test.ts
// #135 (cont.) — responding to a dynamic downtime event had no test
// coverage: the auth gate, and moderation blocking a flagged response
// before it ever reaches the AI (mirroring scene action submission), were
// both unverified.
//
// Follow-up: also previously missing a character-ownership check — any
// authenticated user could respond to any event, regardless of who owns
// the character it belongs to. Now gated by requireDowntimeEventOwner,
// which resolves event -> activity -> character itself rather than
// trusting a client-supplied id.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ verifyAuth: vi.fn() }))
vi.mock('@/lib/db/characterAccess', () => ({ requireDowntimeEventOwner: vi.fn() }))
vi.mock('@/lib/rateLimit', () => ({
  AI_ACTION_LIMIT: { bucket: 'ai-action', limit: 20, windowSeconds: 60 },
  checkRateLimit: vi.fn(),
  rateLimitExceededResponse: vi.fn(),
}))
vi.mock('@/lib/ai/moderation', () => ({ moderatePlayerText: vi.fn() }))
vi.mock('@/lib/downtime/ai-downtime-service', () => ({
  AIDrivenDowntimeService: { respondToDynamicEvent: vi.fn() },
}))

import { verifyAuth } from '@/lib/auth'
import { requireDowntimeEventOwner } from '@/lib/db/characterAccess'
import { checkRateLimit, rateLimitExceededResponse } from '@/lib/rateLimit'
import { moderatePlayerText } from '@/lib/ai/moderation'
import { AIDrivenDowntimeService } from '@/lib/downtime/ai-downtime-service'
import { POST } from '../route'

function req(body: unknown) {
  return new NextRequest('http://localhost/api/dynamic-downtime-events/event1/respond', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(verifyAuth as any).mockResolvedValue({ userId: 'player1' })
  ;(requireDowntimeEventOwner as any).mockResolvedValue({ character: { id: 'char1', userId: 'player1' } })
  ;(checkRateLimit as any).mockResolvedValue({ allowed: true })
  ;(moderatePlayerText as any).mockResolvedValue({ flagged: false })
})

describe('POST', () => {
  it('rejects an unauthenticated request', async () => {
    ;(verifyAuth as any).mockResolvedValue(null)
    const response = await POST(req({ response: 'I flee' }), { params: { id: 'event1' } })
    expect(response.status).toBe(401)
  })

  it('rejects an empty response', async () => {
    const response = await POST(req({ response: '' }), { params: { id: 'event1' } })
    expect(response.status).toBe(400)
  })

  it('404s for an event that does not exist', async () => {
    ;(requireDowntimeEventOwner as any).mockResolvedValue({ response: new Response(null, { status: 404 }) })
    const response = await POST(req({ response: 'I flee' }), { params: { id: 'event1' } })
    expect(response.status).toBe(404)
    expect(checkRateLimit).not.toHaveBeenCalled()
  })

  it('rejects an event whose character belongs to someone else', async () => {
    ;(requireDowntimeEventOwner as any).mockResolvedValue({ response: new Response(null, { status: 403 }) })
    const response = await POST(req({ response: 'I flee' }), { params: { id: 'event1' } })
    expect(response.status).toBe(403)
    expect(AIDrivenDowntimeService.respondToDynamicEvent).not.toHaveBeenCalled()
  })

  it('is rate limited before ever calling moderation', async () => {
    ;(checkRateLimit as any).mockResolvedValue({ allowed: false })
    ;(rateLimitExceededResponse as any).mockReturnValue(new Response(null, { status: 429 }))
    const response = await POST(req({ response: 'I flee' }), { params: { id: 'event1' } })
    expect(response.status).toBe(429)
    expect(moderatePlayerText).not.toHaveBeenCalled()
  })

  it('blocks a flagged response before it reaches the AI', async () => {
    ;(moderatePlayerText as any).mockResolvedValue({ flagged: true, categories: ['hate'] })
    const response = await POST(req({ response: 'bad text' }), { params: { id: 'event1' } })
    expect(response.status).toBe(400)
    expect(AIDrivenDowntimeService.respondToDynamicEvent).not.toHaveBeenCalled()
  })

  // #274: a moderation outage must fail closed, not silently let the
  // response through as if it had been checked and found clean.
  it('#274: fails closed with a 503 when the moderation check itself is unavailable', async () => {
    ;(moderatePlayerText as any).mockResolvedValue({ flagged: true, categories: [], unavailable: true })
    const response = await POST(req({ response: 'anything' }), { params: { id: 'event1' } })
    expect(response.status).toBe(503)
    expect(AIDrivenDowntimeService.respondToDynamicEvent).not.toHaveBeenCalled()
  })

  it('responds to the event for clean input', async () => {
    ;(AIDrivenDowntimeService.respondToDynamicEvent as any).mockResolvedValue({ outcome: 'success' })
    const response = await POST(req({ response: 'I flee' }), { params: { id: 'event1' } })
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body).toEqual({ success: true, outcome: 'success' })
    expect(AIDrivenDowntimeService.respondToDynamicEvent).toHaveBeenCalledWith('event1', 'I flee', undefined)
  })
})
