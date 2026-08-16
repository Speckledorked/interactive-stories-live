// src/app/api/internal/cron/world-tick-sweep/__tests__/route.test.ts
// #135 (cont.) — the daily world-turn cron entry point had no test
// coverage: the CRON_SECRET auth gate (including the "secret not even
// configured" case, which must also reject rather than accept anything),
// and that each maintenance step's failure is caught and logged rather
// than aborting the sweep, were both unverified.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/game/worldTurnSweep', () => ({ sweepWorldTurnsForAllCampaigns: vi.fn() }))
vi.mock('@/lib/game/resolutionQueue', () => ({ sweepGloballyStuckResolutionJobs: vi.fn() }))
// #408: the sweep now prunes the history it just added to, scoped to the
// campaigns that actually ticked.
vi.mock('@/lib/game/retention', () => ({ pruneCampaignHistory: vi.fn() }))
vi.mock('@/lib/notifications/turn-tracker', () => ({
  TurnTracker: { sendPeriodicReminders: vi.fn(), checkExpiredTurns: vi.fn(), notifyOverdueTurns: vi.fn() },
}))

import { sweepWorldTurnsForAllCampaigns } from '@/lib/game/worldTurnSweep'
import { sweepGloballyStuckResolutionJobs } from '@/lib/game/resolutionQueue'
import { TurnTracker } from '@/lib/notifications/turn-tracker'
import { GET } from '../route'

const ORIGINAL_SECRET = process.env.CRON_SECRET

function req(secret?: string) {
  return new NextRequest('http://localhost/api/internal/cron/world-tick-sweep', {
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = 'sweep-secret'
  ;(sweepGloballyStuckResolutionJobs as any).mockResolvedValue(undefined)
  ;(TurnTracker.sendPeriodicReminders as any).mockResolvedValue(undefined)
  ;(TurnTracker.checkExpiredTurns as any).mockResolvedValue(0)
  ;(TurnTracker.notifyOverdueTurns as any).mockResolvedValue(0)
  ;(sweepWorldTurnsForAllCampaigns as any).mockResolvedValue({ ticked: 0, campaignsChecked: 0, failed: 0, skippedAtCap: 0, tickedCampaignIds: [] })
})

afterEach(() => {
  process.env.CRON_SECRET = ORIGINAL_SECRET
})

describe('GET', () => {
  it('rejects a missing Authorization header', async () => {
    const response = await GET(req())
    expect(response.status).toBe(401)
    expect(sweepWorldTurnsForAllCampaigns).not.toHaveBeenCalled()
  })

  it('rejects the wrong secret', async () => {
    const response = await GET(req('wrong-secret'))
    expect(response.status).toBe(401)
  })

  it('rejects everything when CRON_SECRET is not configured, not just anything', async () => {
    delete process.env.CRON_SECRET
    const response = await GET(req('anything'))
    expect(response.status).toBe(401)
  })

  it('runs the sweep and returns its result for the correct secret', async () => {
    ;(sweepWorldTurnsForAllCampaigns as any).mockResolvedValue({ ticked: 2, campaignsChecked: 5, failed: 0, skippedAtCap: 3, tickedCampaignIds: [] })
    const response = await GET(req('sweep-secret'))
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body).toEqual({ ticked: 2, campaignsChecked: 5, failed: 0, skippedAtCap: 3, tickedCampaignIds: [], prunedRows: 0 })
  })

  it('does not abort the sweep when a maintenance step throws', async () => {
    ;(sweepGloballyStuckResolutionJobs as any).mockRejectedValue(new Error('stuck-job sweep down'))
    ;(TurnTracker.sendPeriodicReminders as any).mockRejectedValue(new Error('reminders down'))
    ;(TurnTracker.checkExpiredTurns as any).mockRejectedValue(new Error('expired-turn sweep down'))
    ;(TurnTracker.notifyOverdueTurns as any).mockRejectedValue(new Error('overdue-notification sweep down'))
    const response = await GET(req('sweep-secret'))
    expect(response.status).toBe(200)
    expect(sweepWorldTurnsForAllCampaigns).toHaveBeenCalled()
  })

  it('#320: runs the overdue-turn notification sweep', async () => {
    const response = await GET(req('sweep-secret'))
    expect(response.status).toBe(200)
    expect(TurnTracker.notifyOverdueTurns).toHaveBeenCalled()
  })
})
