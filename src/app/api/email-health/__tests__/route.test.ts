// src/app/api/email-health/__tests__/route.test.ts
// #135 (cont.) — the email plumbing diagnostic page had no test coverage:
// the rate limit, the "no SMTP creds at all" short-circuit (never
// attempting a handshake), and that a rejected login and a successful one
// map to different `ok`/`smtpLogin` shapes, were all unverified.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/rateLimit', () => ({ checkRateLimit: vi.fn() }))

const verify = vi.fn()
vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn(() => ({ verify })) },
}))

import { checkRateLimit } from '@/lib/rateLimit'
import { GET } from '../route'

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  vi.clearAllMocks()
  ;(checkRateLimit as any).mockResolvedValue({ allowed: true })
  process.env.SMTP_USER = 'user@example.com'
  process.env.SMTP_PASSWORD = 'secret'
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
    expect(verify).not.toHaveBeenCalled()
  })

  it('short-circuits with no SMTP credentials, never attempting a handshake', async () => {
    delete process.env.SMTP_USER
    delete process.env.SMTP_PASSWORD
    const response = await GET()
    const body = await response.json()
    expect(body.ok).toBe(false)
    expect(verify).not.toHaveBeenCalled()
  })

  it('reports ok:true when the handshake succeeds and the app URL is set', async () => {
    verify.mockResolvedValue(true)
    const response = await GET()
    const body = await response.json()
    expect(body).toMatchObject({ ok: true, smtpLogin: 'accepted' })
  })

  it('reports ok:false with a warning when the app URL is unset, even on a successful handshake', async () => {
    delete process.env.NEXT_PUBLIC_APP_URL
    verify.mockResolvedValue(true)
    const response = await GET()
    const body = await response.json()
    expect(body.ok).toBe(false)
    expect(body.warning).toBeDefined()
  })

  it('reports smtpLogin:REJECTED when the handshake fails', async () => {
    verify.mockRejectedValue(new Error('535 auth failed'))
    const response = await GET()
    const body = await response.json()
    expect(body).toMatchObject({ ok: false, smtpLogin: 'REJECTED' })
    expect(body.error).toContain('auth failed')
  })
})
