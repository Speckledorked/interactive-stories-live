// src/lib/game/__tests__/cronHeartbeat.test.ts
import { describe, it, expect } from 'vitest'
import { computeHeartbeatBankedHours } from '../cronHeartbeat'

describe('computeHeartbeatBankedHours', () => {
  const now = new Date('2026-07-17T12:00:00Z')

  it('banks nothing on the first-ever sweep (no backlog for time before the cron existed)', () => {
    expect(computeHeartbeatBankedHours(null, now)).toBe(0)
  })

  it('banks the exact real hours elapsed at a 1:1 rate', () => {
    const lastTick = new Date('2026-07-16T12:00:00Z') // 24h ago
    expect(computeHeartbeatBankedHours(lastTick, now)).toBe(24)
  })

  it('banks a fraction of an hour proportionally', () => {
    const lastTick = new Date('2026-07-17T11:30:00Z') // 30 min ago
    expect(computeHeartbeatBankedHours(lastTick, now)).toBe(0.5)
  })

  it('never banks negative hours if lastRealTimeTickAt is somehow in the future', () => {
    const future = new Date('2026-07-18T00:00:00Z')
    expect(computeHeartbeatBankedHours(future, now)).toBe(0)
  })
})
