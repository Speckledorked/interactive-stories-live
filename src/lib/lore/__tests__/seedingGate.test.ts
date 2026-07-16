// src/lib/lore/__tests__/seedingGate.test.ts
// The stale-flag decision that guarantees a world-seeding lock can never
// hold a campaign hostage.

import { describe, it, expect } from 'vitest'
import { seedFlagIsStale, SEED_STALE_GRACE_MS } from '../seedingGate'

describe('seedFlagIsStale', () => {
  const now = 1_000_000_000

  it('never stale while an import job is live', () => {
    expect(seedFlagIsStale(1, null, now)).toBe(false)
    expect(seedFlagIsStale(2, new Date(now - SEED_STALE_GRACE_MS * 10), now)).toBe(false)
  })

  it('immediately stale when the flag has no job behind it at all', () => {
    expect(seedFlagIsStale(0, null, now)).toBe(true)
  })

  it('gives a finished import a grace window for the reseed to run', () => {
    const justFinished = new Date(now - 30_000)
    expect(seedFlagIsStale(0, justFinished, now)).toBe(false)
  })

  it('stale once the grace window after the last job has passed', () => {
    const longAgo = new Date(now - SEED_STALE_GRACE_MS)
    expect(seedFlagIsStale(0, longAgo, now)).toBe(true)
  })
})
