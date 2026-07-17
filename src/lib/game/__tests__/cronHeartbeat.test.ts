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

  it('banks nothing when play already banked the full real-time gap (fully played)', () => {
    const lastTick = new Date('2026-07-16T12:00:00Z') // 24h ago
    expect(computeHeartbeatBankedHours(lastTick, now, 24)).toBe(0)
  })

  it('banks nothing when play banked MORE than the real-time gap (outrun the clock)', () => {
    const lastTick = new Date('2026-07-16T12:00:00Z') // 24h ago
    expect(computeHeartbeatBankedHours(lastTick, now, 40)).toBe(0)
  })

  it('tops up only the remainder when play partially covered the gap', () => {
    const lastTick = new Date('2026-07-16T12:00:00Z') // 24h ago
    expect(computeHeartbeatBankedHours(lastTick, now, 10)).toBe(14)
  })

  it('banks the full elapsed amount when the campaign was not played at all', () => {
    const lastTick = new Date('2026-07-16T12:00:00Z') // 24h ago
    expect(computeHeartbeatBankedHours(lastTick, now, 0)).toBe(24)
  })
})
