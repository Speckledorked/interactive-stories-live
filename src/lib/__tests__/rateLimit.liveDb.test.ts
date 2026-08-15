// src/lib/__tests__/rateLimit.liveDb.test.ts
//
// #295: docs/ARCHITECTURE.md made a specific evidentiary claim — "live-
// verified against real Postgres: the composite IP+email key correctly
// blocked an 11th request against a limit of 10" — that wasn't backed by
// any reproducible automated test. rateLimit.test.ts entirely mocks
// prisma.rateLimitCounter, so it verifies the counting/windowing logic
// against a mock, never the real upsert/composite-key behavior against a
// real database. This exercises checkRateLimit against a live connection
// and proves that claim for real, so it can't silently regress unnoticed.
//
// Opt-in, matching the repo's other *.liveDb.test.ts files:
//
//   RUN_DB_TESTS=1 npx vitest run rateLimit.liveDb

import { describe, it, expect, afterEach, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { checkRateLimit } from '../rateLimit'

const RUN = process.env.RUN_DB_TESTS === '1'
const describeIfDb = RUN ? describe : describe.skip

describeIfDb('checkRateLimit — real database (#295)', () => {
  const prisma = new PrismaClient()
  // Unique per test run so parallel/rerun test runs never collide on the
  // same (key, bucket, windowStart) counter row.
  const testKey = `1.2.3.4+ratelimit-live-test-${Date.now()}@example.com`
  const bucket = 'live-db-test-bucket'

  afterEach(async () => {
    await prisma.rateLimitCounter.deleteMany({ where: { key: { startsWith: `${testKey}:` } } })
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('correctly blocks an 11th request against a limit of 10, using a real composite IP+email key', async () => {
    const limit = 10
    const windowSeconds = 60

    let lastResult
    for (let i = 1; i <= 10; i++) {
      lastResult = await checkRateLimit(testKey, bucket, limit, windowSeconds)
      expect(lastResult.allowed).toBe(true)
    }
    // The 10th request is exactly at the limit — still allowed.
    expect(lastResult!.remaining).toBe(0)

    // The 11th request against the same composite key exceeds the limit.
    const eleventh = await checkRateLimit(testKey, bucket, limit, windowSeconds)
    expect(eleventh.allowed).toBe(false)
    expect(eleventh.remaining).toBe(0)
    expect(eleventh.retryAfterSeconds).toBeGreaterThanOrEqual(1)
  })

  it('tracks a different composite key in its own counter, unaffected by a blocked key', async () => {
    const otherKey = `${testKey}-other`
    const limit = 10
    const windowSeconds = 60

    for (let i = 1; i <= 11; i++) {
      await checkRateLimit(testKey, bucket, limit, windowSeconds)
    }
    const blocked = await checkRateLimit(testKey, bucket, limit, windowSeconds)
    expect(blocked.allowed).toBe(false)

    const otherResult = await checkRateLimit(otherKey, bucket, limit, windowSeconds)
    expect(otherResult.allowed).toBe(true)
    expect(otherResult.remaining).toBe(9)

    await prisma.rateLimitCounter.deleteMany({ where: { key: { startsWith: `${otherKey}:` } } })
  })
})
