// src/lib/ai/__tests__/openaiThrottle.test.ts
//
// #504: nothing anywhere handled a 429, and nothing bounded how many
// provider calls ran at once.
//
// The 429 half is the one worth stating carefully. Every call site fails
// open to a deterministic fallback — a template scene intro, freeform
// resolution, no classification — so a rate-limited deployment did not
// error. It quietly got worse at its job while still producing prose,
// which is the failure mode that takes longest to notice.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { withConcurrencyLimit, backoffDelayMs, isRetryableStatus, THROTTLE_LIMITS } from '../openaiThrottle'

function response(status: number, headers: Record<string, string> = {}): Response {
  return { status, headers: new Headers(headers) } as Response
}

describe('isRetryableStatus', () => {
  it('retries a 429', () => {
    // A rate limit is a statement about timing — the same request will
    // succeed shortly — which is exactly the claim a retry needs.
    expect(isRetryableStatus(429)).toBe(true)
  })

  it('does not retry anything else', () => {
    // 5xx is not a timing claim, and this app's fallback is genuinely good
    // — a caller that degrades immediately loses far less than every
    // caller waiting out three backoffs first. 400 is out for a different
    // reason: that request will keep being wrong, and openaiCompat's own
    // 400 handling is what actually fixes those.
    for (const status of [200, 400, 401, 500, 502, 503, 504]) {
      expect(isRetryableStatus(status), `${status} must not retry`).toBe(false)
    }
  })
})

describe('backoffDelayMs', () => {
  it('honours Retry-After in seconds', () => {
    // The provider knows when its window reopens and we do not.
    expect(backoffDelayMs(response(429, { 'retry-after': '3' }), 0)).toBe(3000)
  })

  it('honours Retry-After as an HTTP date', () => {
    const then = new Date(Date.now() + 5000).toUTCString()
    const delay = backoffDelayMs(response(429, { 'retry-after': then }), 0)
    expect(delay).toBeGreaterThan(3000)
    expect(delay).toBeLessThanOrEqual(5000)
  })

  it('never waits longer than the ceiling, however large Retry-After is', () => {
    expect(backoffDelayMs(response(429, { 'retry-after': '3600' }), 0)).toBe(THROTTLE_LIMITS.MAX_BACKOFF_MS)
  })

  it('treats a past Retry-After date as no wait', () => {
    const past = new Date(Date.now() - 60_000).toUTCString()
    expect(backoffDelayMs(response(429, { 'retry-after': past }), 0)).toBe(0)
  })

  it('backs off exponentially without a Retry-After', () => {
    const first = backoffDelayMs(response(429), 0)
    const third = backoffDelayMs(response(429), 2)
    expect(first).toBeGreaterThan(0)
    expect(third).toBeGreaterThan(first)
    expect(third).toBeLessThanOrEqual(THROTTLE_LIMITS.MAX_BACKOFF_MS)
  })

  it('jitters, so a fan-out does not march back in together', () => {
    // Several calls from one fan-out are rate-limited at the same instant.
    // Identical backoff would return them to the provider simultaneously
    // and reproduce the same 429.
    const delays = new Set(Array.from({ length: 30 }, () => backoffDelayMs(response(429), 3)))
    expect(delays.size).toBeGreaterThan(1)
  })
})

describe('withConcurrencyLimit', () => {
  /**
   * Let every already-runnable continuation run. A fixed number of
   * `await Promise.resolve()` calls is not enough: acquire() resolves
   * through a queued promise, so a released slot takes several hops to
   * reach the waiting call's body, and counting those hops makes the test
   * depend on the implementation's internal shape rather than its
   * behaviour. The first version of this file did exactly that and failed.
   */
  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

  it('never runs more than the limit at once', async () => {
    let running = 0
    let peak = 0
    const resolvers: Array<() => void> = []

    const calls = Array.from({ length: THROTTLE_LIMITS.MAX_CONCURRENT_CALLS + 3 }, () =>
      withConcurrencyLimit(async () => {
        running++
        peak = Math.max(peak, running)
        await new Promise<void>((resolve) => resolvers.push(resolve))
        running--
      })
    )

    await flush()
    expect(peak).toBe(THROTTLE_LIMITS.MAX_CONCURRENT_CALLS)
    expect(resolvers).toHaveLength(THROTTLE_LIMITS.MAX_CONCURRENT_CALLS)

    // Drain, letting each release admit the next waiter.
    while (resolvers.length) {
      resolvers.shift()!()
      await flush()
    }
    await Promise.all(calls)

    // The peak never rose above the limit across the whole drain — the
    // property that would break if release() admitted more than one.
    expect(peak).toBe(THROTTLE_LIMITS.MAX_CONCURRENT_CALLS)
  })

  it('releases its slot when the call throws', async () => {
    // A leaked slot is worse than no limiter: it is a limiter that
    // silently ratchets down to zero and deadlocks every later call.
    for (let i = 0; i < THROTTLE_LIMITS.MAX_CONCURRENT_CALLS; i++) {
      await expect(withConcurrencyLimit(async () => { throw new Error('boom') })).rejects.toThrow('boom')
    }

    let ran = false
    await withConcurrencyLimit(async () => { ran = true })
    expect(ran).toBe(true)
  })

  it('lets a waiting call through as soon as a slot frees', async () => {
    const resolvers: Array<() => void> = []
    const held = Array.from({ length: THROTTLE_LIMITS.MAX_CONCURRENT_CALLS }, () =>
      withConcurrencyLimit(() => new Promise<void>((r) => resolvers.push(r)))
    )

    let queuedRan = false
    const queued = withConcurrencyLimit(async () => { queuedRan = true })

    await flush()
    expect(queuedRan, 'the limit must actually hold a call back').toBe(false)

    resolvers.shift()!()
    await flush()
    expect(queuedRan, 'a freed slot must admit the waiting call').toBe(true)

    while (resolvers.length) resolvers.shift()!()
    await Promise.all([...held, queued])
  })
})
