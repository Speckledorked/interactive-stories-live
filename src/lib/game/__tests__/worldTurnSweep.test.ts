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
      {
        id: 'c1',
        worldMeta: { lastRealTimeTickAt: new Date('2026-07-16T12:00:00Z'), hoursBankedSinceLastHeartbeat: 0 },
      },
      { id: 'c2', worldMeta: { lastRealTimeTickAt: null, hoursBankedSinceLastHeartbeat: 0 } },
    ])
    ;(runWorldTurnIfDue as any).mockResolvedValue({ ran: false })

    const result = await sweepWorldTurnsForAllCampaigns()

    expect(result.campaignsChecked).toBe(2)
    expect(db.worldMeta.update).toHaveBeenCalledTimes(2)
    // c1 had a prior tick and nothing banked by play, so it tops up the full gap
    expect(db.worldMeta.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { campaignId: 'c1' },
        data: expect.objectContaining({
          hoursSinceWorldTurn: { increment: expect.any(Number) },
          hoursBankedSinceLastHeartbeat: 0,
        }),
      })
    )
    // c2 has never been swept, so nothing is banked (increment key omitted)
    expect(db.worldMeta.update).toHaveBeenCalledWith({
      where: { campaignId: 'c2' },
      data: { hoursSinceWorldTurn: undefined, lastRealTimeTickAt: expect.any(Date), hoursBankedSinceLastHeartbeat: 0 },
    })
    expect(runWorldTurnIfDue).toHaveBeenCalledTimes(2)
  })

  it('tops up only the unplayed remainder when play already banked part of the gap', async () => {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
    db.campaign.findMany.mockResolvedValue([
      {
        id: 'c1',
        worldMeta: { lastRealTimeTickAt: twentyFourHoursAgo, hoursBankedSinceLastHeartbeat: 100 },
      },
    ])
    ;(runWorldTurnIfDue as any).mockResolvedValue({ ran: false })

    await sweepWorldTurnsForAllCampaigns()

    // ~24h real elapsed, play already banked more than that — nothing left to top up
    expect(db.worldMeta.update).toHaveBeenCalledWith({
      where: { campaignId: 'c1' },
      data: { hoursSinceWorldTurn: undefined, lastRealTimeTickAt: expect.any(Date), hoursBankedSinceLastHeartbeat: 0 },
    })
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

  // #282: without fairness ordering, campaigns come back in stable scan
  // order every sweep, so the same first MAX_TURNS_PER_SWEEP always win
  // the cap and everything past that position is permanently starved, not
  // just delayed.
  it('orders campaigns by most-overdue-first for the cap to actually rotate through', async () => {
    db.campaign.findMany.mockResolvedValue([{ id: 'c1', worldMeta: { lastRealTimeTickAt: null } }])
    ;(runWorldTurnIfDue as any).mockResolvedValue({ ran: false })

    await sweepWorldTurnsForAllCampaigns()

    expect(db.campaign.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { worldMeta: { hoursSinceWorldTurn: 'desc' } } })
    )
  })

  // #297: banking now runs in bounded-parallel batches rather than one
  // sequential await per campaign — a campaign whose banking update itself
  // fails must still be isolated (no crash of the whole sweep) and must
  // still be excluded from the turn-tick phase, matching the original
  // single-loop behavior where a banking failure skipped that campaign's
  // tick too.
  it('isolates a banking failure to one campaign, excludes it from ticking, and still ticks the rest', async () => {
    db.campaign.findMany.mockResolvedValue([
      { id: 'bad-bank', worldMeta: { lastRealTimeTickAt: null } },
      { id: 'good', worldMeta: { lastRealTimeTickAt: null } },
    ])
    db.worldMeta.update.mockImplementation(async ({ where }: any) => {
      if (where.campaignId === 'bad-bank') throw new Error('banking boom')
      return {}
    })
    ;(runWorldTurnIfDue as any).mockResolvedValue({ ran: true })

    const result = await sweepWorldTurnsForAllCampaigns()

    expect(result.failed).toBe(1)
    expect(result.ticked).toBe(1)
    // Only the campaign that banked successfully is ever ticked.
    expect(runWorldTurnIfDue).toHaveBeenCalledTimes(1)
    expect(runWorldTurnIfDue).toHaveBeenCalledWith('good')
  })

  it('banks a large campaign count across more than one batch without dropping any', async () => {
    const campaigns = Array.from({ length: 45 }, (_, i) => ({
      id: `c${i}`,
      worldMeta: { lastRealTimeTickAt: null },
    }))
    db.campaign.findMany.mockResolvedValue(campaigns)
    ;(runWorldTurnIfDue as any).mockResolvedValue({ ran: false })

    const result = await sweepWorldTurnsForAllCampaigns()

    expect(result.campaignsChecked).toBe(45)
    expect(db.worldMeta.update).toHaveBeenCalledTimes(45) // every campaign banked, across multiple batches
    expect(result.failed).toBe(0)
  })

  it('rotates every campaign through the cap across consecutive days, not just the first 25 forever', async () => {
    // 30 campaigns, more than MAX_TURNS_PER_SWEEP (25) — simulates the
    // real orderBy by sorting on each findMany call, and simulates a real
    // tick resetting hoursSinceWorldTurn back down (worldTurn.ts's own
    // remainingHours behavior) so a ticked campaign naturally falls to
    // the back of tomorrow's queue instead of winning the cap again.
    const state = new Map<string, number>(
      Array.from({ length: 30 }, (_, i) => [`c${i}`, 100 + i])
    )
    db.campaign.findMany.mockImplementation(async () => {
      return [...state.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([id]) => ({ id, worldMeta: { lastRealTimeTickAt: null, hoursSinceWorldTurn: state.get(id) } }))
    })

    const tickedEachDay: string[][] = []
    for (let day = 0; day < 3; day++) {
      const tickedIds: string[] = []
      ;(runWorldTurnIfDue as any).mockImplementation(async (campaignId: string) => {
        tickedIds.push(campaignId)
        state.set(campaignId, 0)
        return { ran: true }
      })

      await sweepWorldTurnsForAllCampaigns()
      tickedEachDay.push(tickedIds)

      // Real elapsed time passing: every campaign not ticked today grows
      // more overdue, exactly like hoursSinceWorldTurn accumulating.
      for (const id of state.keys()) {
        if (!tickedIds.includes(id)) state.set(id, (state.get(id) ?? 0) + 24)
      }
    }

    const everTicked = new Set(tickedEachDay.flat())
    // Day 1 and day 2 must NOT tick the identical set — real rotation, not
    // the same 25 winning every single day.
    expect(new Set(tickedEachDay[0])).not.toEqual(new Set(tickedEachDay[1]))
    // Across enough days, campaigns beyond the original top 25 must
    // eventually get a turn too — nobody is permanently starved.
    expect(everTicked.size).toBeGreaterThan(25)
  })
})
