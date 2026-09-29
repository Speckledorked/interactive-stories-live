// src/app/api/ai-health/__tests__/route.test.ts
// #135 (cont.) — the AI pipeline diagnostic page had no test coverage:
// the rate limit, the "no key at all" short-circuit (never reaching the
// provider), and that a per-model failure is reported per-check rather
// than aborting the whole page, were all unverified.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/rateLimit', () => ({ checkRateLimit: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getUser: vi.fn() }))
vi.mock('@/lib/auth/platformAdmin', () => ({ isPlatformAdminEmail: vi.fn() }))

vi.mock('@/lib/ai/openaiCompat', () => ({ openaiFetch: vi.fn() }))
vi.mock('@/lib/ai/models', () => ({ AI_MODELS: { efficient: 'gpt-efficient', premium: 'gpt-premium' } }))

import { checkRateLimit } from '@/lib/rateLimit'
import { getUser } from '@/lib/auth'
import { isPlatformAdminEmail } from '@/lib/auth/platformAdmin'
import { openaiFetch } from '@/lib/ai/openaiCompat'
import { GET } from '../route'

const ORIGINAL_KEY = process.env.OPENAI_API_KEY

beforeEach(() => {
  vi.clearAllMocks()
  ;(checkRateLimit as any).mockResolvedValue({ allowed: true })
  ;(getUser as any).mockResolvedValue({ userId: 'admin-1', email: 'operator@example.com' })
  ;(isPlatformAdminEmail as any).mockReturnValue(true)
  process.env.OPENAI_API_KEY = 'sk-test'
})

afterEach(() => {
  process.env.OPENAI_API_KEY = ORIGINAL_KEY
})

/** The handler only reads cookies via getUser, which is mocked — so any
 * NextRequest-shaped object is enough to satisfy the signature. */
const REQUEST = {} as any

describe('GET', () => {
  it('is rate limited', async () => {
    ;(checkRateLimit as any).mockResolvedValue({ allowed: false })
    const response = await GET(REQUEST)
    expect(response.status).toBe(429)
    expect(openaiFetch).not.toHaveBeenCalled()
  })

  it('short-circuits with no key present, never calling the provider', async () => {
    delete process.env.OPENAI_API_KEY
    const response = await GET(REQUEST)
    const body = await response.json()
    expect(body).toEqual({ ok: false, keyPresent: false, error: expect.any(String), checks: [] })
    expect(openaiFetch).not.toHaveBeenCalled()
  })

  it('reports ok:true when every configured model replies successfully', async () => {
    ;(openaiFetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    })
    const response = await GET(REQUEST)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.keyPresent).toBe(true)
    expect(body.checks).toHaveLength(2)
    expect(body.checks.every((c: any) => c.ok)).toBe(true)
  })

  it('reports a single failing model per-check without aborting the others', async () => {
    ;(openaiFetch as any)
      .mockResolvedValueOnce({ ok: false, status: 401, text: async () => 'invalid key' })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) })
    const response = await GET(REQUEST)
    const body = await response.json()
    expect(body.ok).toBe(false)
    expect(body.checks).toHaveLength(2)
    expect(body.checks[0]).toMatchObject({ ok: false, status: 401 })
    expect(body.checks[1]).toMatchObject({ ok: true })
  })

  it('catches a thrown network error per-model instead of failing the request', async () => {
    ;(openaiFetch as any).mockRejectedValue(new Error('network down'))
    const response = await GET(REQUEST)
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.checks.every((c: any) => !c.ok)).toBe(true)
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
    expect(openaiFetch).not.toHaveBeenCalled()
  })

  it('rejects a signed-in caller who is not a platform admin', async () => {
    ;(isPlatformAdminEmail as any).mockReturnValue(false)
    const response = await GET(REQUEST)
    expect(response.status).toBe(403)
    expect(openaiFetch).not.toHaveBeenCalled()
  })

  it('keys the rate limit on the caller, not a shared bucket', async () => {
    await GET(REQUEST)
    expect(checkRateLimit).toHaveBeenCalledWith('admin-1', 'ai-health', expect.any(Number), expect.any(Number))
  })
})
