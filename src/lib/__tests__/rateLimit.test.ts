import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    rateLimitCounter: { upsert: vi.fn(), deleteMany: vi.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import { checkRateLimit, computeWindowStart } from '../rateLimit'

describe('computeWindowStart (pure)', () => {
  it('floors to the containing window', () => {
    // 90s into the epoch with a 60s window -> window starts at 60s
    expect(computeWindowStart(90_000, 60).getTime()).toBe(60_000)
  })

  it('is stable for every instant inside one window', () => {
    const a = computeWindowStart(120_000, 60)
    const b = computeWindowStart(179_999, 60)
    expect(a.getTime()).toBe(b.getTime())
  })

  it('rolls over exactly on the boundary', () => {
    expect(computeWindowStart(180_000, 60).getTime()).toBe(180_000)
  })
})

describe('checkRateLimit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.rateLimitCounter.deleteMany).mockResolvedValue({ count: 0 } as any)
  })

  it('allows requests under the limit', async () => {
    vi.mocked(prisma.rateLimitCounter.upsert).mockResolvedValueOnce({ count: 3 } as any)
    const result = await checkRateLimit('user-1', 'ai-action', 10, 60)
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(7)
  })

  it('blocks the request that exceeds the limit, with a positive Retry-After', async () => {
    vi.mocked(prisma.rateLimitCounter.upsert).mockResolvedValueOnce({ count: 11 } as any)
    const result = await checkRateLimit('user-1', 'ai-action', 10, 60)
    expect(result.allowed).toBe(false)
    expect(result.remaining).toBe(0)
    expect(result.retryAfterSeconds).toBeGreaterThanOrEqual(1)
  })

  it('allows the request exactly at the limit', async () => {
    vi.mocked(prisma.rateLimitCounter.upsert).mockResolvedValueOnce({ count: 10 } as any)
    const result = await checkRateLimit('user-1', 'ai-action', 10, 60)
    expect(result.allowed).toBe(true)
  })

  it('prunes old windows only on the first request of a new window', async () => {
    vi.mocked(prisma.rateLimitCounter.upsert).mockResolvedValueOnce({ count: 1 } as any)
    await checkRateLimit('user-1', 'ai-action', 10, 60)
    expect(prisma.rateLimitCounter.deleteMany).toHaveBeenCalledTimes(1)

    vi.mocked(prisma.rateLimitCounter.upsert).mockResolvedValueOnce({ count: 2 } as any)
    await checkRateLimit('user-1', 'ai-action', 10, 60)
    expect(prisma.rateLimitCounter.deleteMany).toHaveBeenCalledTimes(1) // unchanged
  })

  it('fails open when the database is unavailable', async () => {
    vi.mocked(prisma.rateLimitCounter.upsert).mockRejectedValueOnce(new Error('db down'))
    const result = await checkRateLimit('user-1', 'ai-action', 10, 60)
    expect(result.allowed).toBe(true)
  })
})
