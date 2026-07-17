// src/lib/game/__tests__/worldTurnSweep.test.ts
// The cron sweep orchestrator: banks real-time hours for every active
// campaign, then checks whether that's enough to trigger a world turn,
// with a cap on how many turns actually run per sweep.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: { findMany: vi.fn() },
    worldMeta: { update: vi.fn() },
  },
}))
vi.mock('../worldTurn', () => ({
  runWorldTurnIfDue: vi.fn(),
}))

import { prisma } from '@/lib/prisma'
import { runWorldTurnIfDue } from '../worldTurn'
import { sweepWorldTurnsForAllCampaigns } from '../worldTurnSweep'

const db = prisma as any

beforeEach(() => {
  vi.clearAllMocks()
  db.worldMeta.update.mockResolvedValue({})
})

describe('sweepWorldTurnsForAllCampaigns', () => {
  it('banks hours and checks every active campaign', async () => {
    db.campaign.findMany.mockResolvedValue([
      { id: 'c1', worldMeta: { lastRealTimeTickAt: new Date('2026-07-16T12:00:00Z') } },
      { id: 'c2', worldMeta: { lastRealTimeTickAt: null } },
    ])
    ;(runWorldTurnIfDue as any).mockResolvedValue({ ran: false })

    const result = await sweepWorldTurnsForAllCampaigns()

    expect(result.campaignsChecked).toBe(2)
    expect(db.worldMeta.update).toHaveBeenCalledTimes(2)
    // c1 had a prior tick, so it banks a real increment
    expect(db.worldMeta.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { campaignId: 'c1' },
        data: expect.objectContaining({ hoursSinceWorldTurn: { increment: expect.any(Number) } }),
      })
    )
    // c2 has never been swept, so nothing is banked (increment key omitted)
    expect(db.worldMeta.update).toHaveBeenCalledWith({
      where: { campaignId: 'c2' },
      data: { hoursSinceWorldTurn: undefined, lastRealTimeTickAt: expect.any(Date) },
    })
    expect(runWorldTurnIfDue).toHaveBeenCalledTimes(2)
  })

  it('counts a ticked campaign when the turn actually ran', async () => {
    db.campaign.findMany.mockResolvedValue([{ id: 'c1', worldMeta: { lastRealTimeTickAt: null } }])
    ;(runWorldTurnIfDue as any).mockResolvedValue({ ran: true })

    const result = await sweepWorldTurnsForAllCampaigns()

    expect(result.ticked).toBe(1)
    expect(result.failed).toBe(0)
  })

  it('isolates a failure to one campaign and keeps sweeping the rest', async () => {
    db.campaign.findMany.mockResolvedValue([
      { id: 'bad', worldMeta: { lastRealTimeTickAt: null } },
      { id: 'good', worldMeta: { lastRealTimeTickAt: null } },
    ])
    ;(runWorldTurnIfDue as any)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ ran: true })

    const result = await sweepWorldTurnsForAllCampaigns()

    expect(result.failed).toBe(1)
    expect(result.ticked).toBe(1)
    expect(runWorldTurnIfDue).toHaveBeenCalledTimes(2)
  })

  it('defers turns past the per-sweep cap without skipping the banking step', async () => {
    const campaigns = Array.from({ length: 27 }, (_, i) => ({
      id: `c${i}`,
      worldMeta: { lastRealTimeTickAt: null },
    }))
    db.campaign.findMany.mockResolvedValue(campaigns)
    ;(runWorldTurnIfDue as any).mockResolvedValue({ ran: false })

    const result = await sweepWorldTurnsForAllCampaigns()

    expect(result.campaignsChecked).toBe(27)
    expect(db.worldMeta.update).toHaveBeenCalledTimes(27) // every campaign still gets banked
    expect(runWorldTurnIfDue).toHaveBeenCalledTimes(25) // capped
    expect(result.skippedAtCap).toBe(2)
  })
})
