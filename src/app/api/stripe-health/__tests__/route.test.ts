// src/app/api/stripe-health/__tests__/route.test.ts
// #135 (cont.) — the Stripe diagnostic page had no test coverage: the
// rate limit, the "no secret key at all" short-circuit (never
// constructing a client), and that a rejected key vs. missing
// webhook-secret/app-url vs. full success all map to different
// ok/warning shapes, were all unverified.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/rateLimit', () => ({ checkRateLimit: vi.fn() }))

const balanceRetrieve = vi.fn()
vi.mock('stripe', () => ({
  default: class {
    balance = { retrieve: balanceRetrieve }
  },
}))

import { checkRateLimit } from '@/lib/rateLimit'
import { GET } from '../route'

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  vi.clearAllMocks()
  ;(checkRateLimit as any).mockResolvedValue({ allowed: true })
  process.env.STRIPE_SECRET_KEY = 'sk_test_123'
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_123'
  process.env.NEXT_PUBLIC_APP_URL = 'https://example.com'
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('GET', () => {
  it('is rate limited', async () => {
    ;(checkRateLimit as any).mockResolvedValue({ allowed: false })
    const response = await GET()
    expect(response.status).toBe(429)
    expect(balanceRetrieve).not.toHaveBeenCalled()
  })

  it('short-circuits with no secret key, never constructing a client', async () => {
    delete process.env.STRIPE_SECRET_KEY
    const response = await GET()
    const body = await response.json()
    expect(body.ok).toBe(false)
    expect(balanceRetrieve).not.toHaveBeenCalled()
  })

  it('reports ok:true when the key is valid and everything else is configured', async () => {
    balanceRetrieve.mockResolvedValue({})
    const response = await GET()
    const body = await response.json()
    expect(body).toMatchObject({ ok: true, secretKey: 'valid' })
  })

  it('reports ok:false with a warning when the webhook secret is missing', async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET
    balanceRetrieve.mockResolvedValue({})
    const response = await GET()
    const body = await response.json()
    expect(body.ok).toBe(false)
    expect(body.warning).toBeDefined()
  })

  it('reports secretKey:REJECTED when the key fails to authenticate', async () => {
    balanceRetrieve.mockRejectedValue(new Error('Invalid API Key provided'))
    const response = await GET()
    const body = await response.json()
    expect(body).toMatchObject({ ok: false, secretKey: 'REJECTED' })
    expect(body.error).toContain('Invalid API Key')
  })
})
