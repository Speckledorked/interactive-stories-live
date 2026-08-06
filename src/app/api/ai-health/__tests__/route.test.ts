// src/app/api/ai-health/__tests__/route.test.ts
// #135 (cont.) — the AI pipeline diagnostic page had no test coverage:
// the rate limit, the "no key at all" short-circuit (never reaching the
// provider), and that a per-model failure is reported per-check rather
// than aborting the whole page, were all unverified.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/rateLimit', () => ({ checkRateLimit: vi.fn() }))
vi.mock('@/lib/ai/openaiCompat', () => ({ openaiFetch: vi.fn() }))
vi.mock('@/lib/ai/models', () => ({ AI_MODELS: { efficient: 'gpt-efficient', premium: 'gpt-premium' } }))

import { checkRateLimit } from '@/lib/rateLimit'
import { openaiFetch } from '@/lib/ai/openaiCompat'
import { GET } from '../route'

const ORIGINAL_KEY = process.env.OPENAI_API_KEY

beforeEach(() => {
  vi.clearAllMocks()
  ;(checkRateLimit as any).mockResolvedValue({ allowed: true })
  process.env.OPENAI_API_KEY = 'sk-test'
})

afterEach(() => {
  process.env.OPENAI_API_KEY = ORIGINAL_KEY
})

describe('GET', () => {
  it('is rate limited', async () => {
    ;(checkRateLimit as any).mockResolvedValue({ allowed: false })
    const response = await GET()
    expect(response.status).toBe(429)
    expect(openaiFetch).not.toHaveBeenCalled()
  })

  it('short-circuits with no key present, never calling the provider', async () => {
    delete process.env.OPENAI_API_KEY
    const response = await GET()
    const body = await response.json()
    expect(body).toEqual({ ok: false, keyPresent: false, error: expect.any(String), checks: [] })
    expect(openaiFetch).not.toHaveBeenCalled()
  })

  it('reports ok:true when every configured model replies successfully', async () => {
    ;(openaiFetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    })
    const response = await GET()
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
    const response = await GET()
    const body = await response.json()
    expect(body.ok).toBe(false)
    expect(body.checks).toHaveLength(2)
    expect(body.checks[0]).toMatchObject({ ok: false, status: 401 })
    expect(body.checks[1]).toMatchObject({ ok: true })
  })

  it('catches a thrown network error per-model instead of failing the request', async () => {
    ;(openaiFetch as any).mockRejectedValue(new Error('network down'))
    const response = await GET()
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.checks.every((c: any) => !c.ok)).toBe(true)
  })
})
