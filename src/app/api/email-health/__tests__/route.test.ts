// src/app/api/email-health/__tests__/route.test.ts
// #135 (cont.) — the email plumbing diagnostic page had no test coverage:
// the rate limit, the "no SMTP creds at all" short-circuit (never
// attempting a handshake), and that a rejected login and a successful one
// map to different `ok`/`smtpLogin` shapes, were all unverified.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/rateLimit', () => ({ checkRateLimit: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getUser: vi.fn() }))
vi.mock('@/lib/auth/platformAdmin', () => ({ isPlatformAdminEmail: vi.fn() }))


const verify = vi.fn()
vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn(() => ({ verify })) },
}))

import { checkRateLimit } from '@/lib/rateLimit'
import { getUser } from '@/lib/auth'
import { isPlatformAdminEmail } from '@/lib/auth/platformAdmin'
import { GET } from '../route'

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  vi.clearAllMocks()
  ;(checkRateLimit as any).mockResolvedValue({ allowed: true })
  ;(getUser as any).mockResolvedValue({ userId: 'admin-1', email: 'operator@example.com' })
  ;(isPlatformAdminEmail as any).mockReturnValue(true)
  process.env.SMTP_USER = 'user@example.com'
  process.env.SMTP_PASSWORD = 'secret'
  process.env.NEXT_PUBLIC_APP_URL = 'https://example.com'
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

/** The handler only reads cookies via getUser, which is mocked — so any
 * NextRequest-shaped object is enough to satisfy the signature. */
const REQUEST = {} as any

describe('GET', () => {
  it('is rate limited', async () => {
    ;(checkRateLimit as any).mockResolvedValue({ allowed: false })
    const response = await GET(REQUEST)
    expect(response.status).toBe(429)
    expect(verify).not.toHaveBeenCalled()
  })

  it('short-circuits with no SMTP credentials, never attempting a handshake', async () => {
    delete process.env.SMTP_USER
    delete process.env.SMTP_PASSWORD
    const response = await GET(REQUEST)
    const body = await response.json()
    expect(body.ok).toBe(false)
    expect(verify).not.toHaveBeenCalled()
  })

  it('reports ok:true when the handshake succeeds and the app URL is set', async () => {
    verify.mockResolvedValue(true)
    const response = await GET(REQUEST)
    const body = await response.json()
    expect(body).toMatchObject({ ok: true, smtpLogin: 'accepted' })
  })

  it('reports ok:false with a warning when the app URL is unset, even on a successful handshake', async () => {
    delete process.env.NEXT_PUBLIC_APP_URL
    verify.mockResolvedValue(true)
    const response = await GET(REQUEST)
    const body = await response.json()
    expect(body.ok).toBe(false)
    expect(body.warning).toBeDefined()
  })

  it('reports smtpLogin:REJECTED when the handshake fails', async () => {
    verify.mockRejectedValue(new Error('535 auth failed'))
    const response = await GET(REQUEST)
    const body = await response.json()
    expect(body).toMatchObject({ ok: false, smtpLogin: 'REJECTED' })
    expect(body.error).toContain('auth failed')
  })
})

describe('GET authorisation', () => {
  // #509: this route used to be anonymous, with a rate limit standing in
  // for a gate. A limit bounds how often the internet can do a thing; it
  // does not decide who may.
  it('rejects an unauthenticated caller before doing any work', async () => {
    ;(getUser as any).mockResolvedValue(null)
    const response = await GET(REQUEST)
    expect(response.status).toBe(401)
    expect(verify).not.toHaveBeenCalled()
  })

  it('rejects a signed-in caller who is not a platform admin', async () => {
    ;(isPlatformAdminEmail as any).mockReturnValue(false)
    const response = await GET(REQUEST)
    expect(response.status).toBe(403)
    expect(verify).not.toHaveBeenCalled()
  })

  it('keys the rate limit on the caller, not a shared bucket', async () => {
    await GET(REQUEST)
    expect(checkRateLimit).toHaveBeenCalledWith('admin-1', 'email-health', expect.any(Number), expect.any(Number))
  })
})
