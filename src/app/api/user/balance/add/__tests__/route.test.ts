// src/app/api/user/balance/add/__tests__/route.test.ts
// #93 — the money-affecting route with the highest priority in this pass:
// creates a real Stripe Checkout session. Untested despite that.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn() }))
vi.mock('@/lib/stripe', () => ({
  stripe: { checkout: { sessions: { create: vi.fn() } } },
}))
vi.mock('@/lib/appUrl', () => ({ getAppUrl: vi.fn().mockReturnValue('https://mythos.example') }))

import { requireAuth } from '@/lib/auth'
import { stripe } from '@/lib/stripe'
import { POST } from '../route'

function req(body: unknown) {
  return new NextRequest('http://localhost/api/user/balance/add', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(requireAuth as any).mockResolvedValue({ userId: 'user1', email: 'user1@example.com' })
})

describe('POST', () => {
  it('returns 401 when unauthenticated', async () => {
    ;(requireAuth as any).mockRejectedValue(new Error('Unauthorized'))
    const response = await POST(req({ amountInCents: 1000 }))
    expect(response.status).toBe(401)
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled()
  })

  it('rejects a missing amount', async () => {
    const response = await POST(req({}))
    expect(response.status).toBe(400)
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled()
  })

  it('rejects a non-numeric amount', async () => {
    const response = await POST(req({ amountInCents: '1000' }))
    expect(response.status).toBe(400)
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled()
  })

  it('rejects an amount below the minimum', async () => {
    const response = await POST(req({ amountInCents: 10 }))
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toMatch(/minimum amount/i)
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled()
  })

  it('rejects a zero amount (falsy, caught by the same missing-amount check)', async () => {
    const response = await POST(req({ amountInCents: 0 }))
    expect(response.status).toBe(400)
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled()
  })

  it('creates a checkout session tied to the authenticated user, never a userId from the body', async () => {
    ;(stripe.checkout.sessions.create as any).mockResolvedValue({ id: 'cs_123', url: 'https://checkout.stripe.com/pay/cs_123' })

    const response = await POST(req({ amountInCents: 2000, userId: 'someone-elses-id' }))
    const responseBody = await response.json()

    expect(response.status).toBe(200)
    expect(responseBody).toEqual({ checkoutUrl: 'https://checkout.stripe.com/pay/cs_123', sessionId: 'cs_123' })

    const call = (stripe.checkout.sessions.create as any).mock.calls[0][0]
    expect(call.client_reference_id).toBe('user1')
    expect(call.metadata).toEqual({ userId: 'user1', amountInCents: '2000', type: 'add_funds' })
    expect(call.line_items[0].price_data.unit_amount).toBe(2000)
    expect(call.mode).toBe('payment')
  })

  it('builds success/cancel URLs from the app URL', async () => {
    ;(stripe.checkout.sessions.create as any).mockResolvedValue({ id: 'cs_123', url: 'https://checkout.stripe.com/pay/cs_123' })

    await POST(req({ amountInCents: 2000 }))

    const call = (stripe.checkout.sessions.create as any).mock.calls[0][0]
    expect(call.success_url).toBe('https://mythos.example?payment=success')
    expect(call.cancel_url).toBe('https://mythos.example?payment=cancelled')
  })

  it('500s with details when Stripe returns no checkout URL', async () => {
    ;(stripe.checkout.sessions.create as any).mockResolvedValue({ id: 'cs_123', url: null })
    const response = await POST(req({ amountInCents: 2000 }))
    expect(response.status).toBe(500)
  })

  it('surfaces a thrown Stripe error as a 500 with details, not a raw crash', async () => {
    ;(stripe.checkout.sessions.create as any).mockRejectedValue(new Error('card declined'))
    const response = await POST(req({ amountInCents: 2000 }))
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.details).toBe('card declined')
  })
})
