// src/app/api/stripe/webhook/__tests__/route.test.ts
// Route-level: the payment webhook is the one place real money enters a
// user's balance, so signature verification and the credit path are
// tested against the actual handler, not just the lib functions it calls.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/stripe', () => ({
  stripe: { webhooks: { constructEvent: vi.fn() } },
  getStripeWebhookSecret: vi.fn().mockReturnValue('whsec_test'),
}))
vi.mock('@/lib/payment/service', () => ({
  addFunds: vi.fn(),
  formatCurrency: (cents: number) => `$${(cents / 100).toFixed(2)}`,
}))

import { stripe } from '@/lib/stripe'
import { addFunds } from '@/lib/payment/service'
import { POST } from '../route'

function makeRequest(body: string, signature?: string) {
  return new NextRequest('http://localhost/api/stripe/webhook', {
    method: 'POST',
    headers: signature ? { 'stripe-signature': signature } : {},
    body,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/stripe/webhook', () => {
  it('rejects a request with no stripe-signature header', async () => {
    const response = await POST(makeRequest('{}'))
    expect(response.status).toBe(400)
    const json = await response.json()
    expect(json.error).toContain('signature')
    expect(stripe.webhooks.constructEvent).not.toHaveBeenCalled()
  })

  it('rejects a request whose signature fails verification', async () => {
    ;(stripe.webhooks.constructEvent as any).mockImplementation(() => {
      throw new Error('invalid signature')
    })

    const response = await POST(makeRequest('{}', 'bad-sig'))

    expect(response.status).toBe(400)
    const json = await response.json()
    expect(json.error).toContain('invalid signature')
    expect(addFunds).not.toHaveBeenCalled()
  })

  it('credits the user balance on a valid checkout.session.completed event', async () => {
    ;(stripe.webhooks.constructEvent as any).mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_123',
          metadata: { userId: 'user1', amountInCents: '500', type: 'add_funds' },
        },
      },
    })
    ;(addFunds as any).mockResolvedValue({ success: true, newBalance: 500 })

    const response = await POST(makeRequest('{}', 'good-sig'))

    expect(response.status).toBe(200)
    expect(addFunds).toHaveBeenCalledWith('user1', 500, expect.stringContaining('cs_test_123'))
  })

  it('rejects a checkout session missing userId in metadata', async () => {
    ;(stripe.webhooks.constructEvent as any).mockReturnValue({
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_test_456', metadata: { amountInCents: '500', type: 'add_funds' } } },
    })

    const response = await POST(makeRequest('{}', 'good-sig'))

    expect(response.status).toBe(400)
    expect(addFunds).not.toHaveBeenCalled()
  })

  it('rejects a session whose metadata type is not add_funds', async () => {
    ;(stripe.webhooks.constructEvent as any).mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: { id: 'cs_test_789', metadata: { userId: 'user1', amountInCents: '500', type: 'something_else' } },
      },
    })

    const response = await POST(makeRequest('{}', 'good-sig'))

    expect(response.status).toBe(400)
    expect(addFunds).not.toHaveBeenCalled()
  })

  it('returns 500 when crediting funds fails', async () => {
    ;(stripe.webhooks.constructEvent as any).mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: { id: 'cs_test_999', metadata: { userId: 'user1', amountInCents: '500', type: 'add_funds' } },
      },
    })
    ;(addFunds as any).mockResolvedValue({ success: false, error: 'DB down' })

    const response = await POST(makeRequest('{}', 'good-sig'))

    expect(response.status).toBe(500)
  })

  it('acknowledges but ignores event types it does not handle', async () => {
    ;(stripe.webhooks.constructEvent as any).mockReturnValue({
      type: 'customer.created',
      data: { object: {} },
    })

    const response = await POST(makeRequest('{}', 'good-sig'))

    expect(response.status).toBe(200)
    expect(addFunds).not.toHaveBeenCalled()
  })
})
