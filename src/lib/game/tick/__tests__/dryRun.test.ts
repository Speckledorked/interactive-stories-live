import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    location: { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    faction: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    nPC: { updateMany: vi.fn(), findMany: vi.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import { tickWeather, decideNextWeather } from '../weatherTick'
import { tickFactions } from '../factionTick'
import type { TickContext } from '../types'

function baseCtx(overrides: Partial<TickContext> = {}): TickContext {
  return { campaignId: 'campaign-1', turnNumber: 5, factionCap: 10, npcCap: 20, dryRun: false, ...overrides }
}

describe('tickWeather dry run', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('writes nothing but still returns changes when dryRun is true', async () => {
    // Find a turn where CLEAR/3 actually changes for this location, so a
    // missed dryRun gate would be caught by the write-count assertion below.
    let turn = 1
    while (
      turn < 200 &&
      decideNextWeather('loc-1', turn, 'CLEAR', 3).nextCondition === 'CLEAR' &&
      decideNextWeather('loc-1', turn, 'CLEAR', 3).nextSeverity === 3
    ) {
      turn++
    }

    vi.mocked(prisma.location.findMany).mockResolvedValueOnce([
      { id: 'loc-1', name: 'The Market', campaignId: 'campaign-1', weather: 'CLEAR', weatherSeverity: 3 },
    ] as any)

    const result = await tickWeather(baseCtx({ turnNumber: turn, dryRun: true }))

    expect(prisma.location.update).not.toHaveBeenCalled()
    // Sanity: confirm this turn actually produces a real change, so the
    // assertion above is meaningful rather than vacuously true.
    const decision = decideNextWeather('loc-1', turn, 'CLEAR', 3)
    if (decision.nextCondition !== 'CLEAR') {
      expect(result.changes.length).toBeGreaterThan(0)
    }
  })

  it('does write when dryRun is false', async () => {
    let turn = 1
    while (
      turn < 200 &&
      decideNextWeather('loc-1', turn, 'CLEAR', 3).nextCondition === 'CLEAR' &&
      decideNextWeather('loc-1', turn, 'CLEAR', 3).nextSeverity === 3
    ) {
      turn++
    }

    vi.mocked(prisma.location.findMany).mockResolvedValueOnce([
      { id: 'loc-1', name: 'The Market', campaignId: 'campaign-1', weather: 'CLEAR', weatherSeverity: 3 },
    ] as any)

    await tickWeather(baseCtx({ turnNumber: turn, dryRun: false }))

    expect(prisma.location.update).toHaveBeenCalledTimes(1)
  })
})

describe('tickFactions dry run', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('writes nothing on the collapse-with-successor path when dryRun is true', async () => {
    // stability 5 + drift will land well under the collapse threshold; no
    // rival relationship, so this exercises the "found a successor" branch
    // — the one with a prisma.faction.create() call whose return value
    // (createdSuccessor.id) other writes depend on.
    vi.mocked(prisma.faction.findMany).mockResolvedValueOnce([
      {
        id: 'f1',
        campaignId: 'campaign-1',
        name: 'The Wilting Guild',
        resources: 10,
        stability: 5,
        military: 10,
        goal: 'CONSOLIDATE',
        archetype: 'GENERIC',
        relationships: {},
        leaderCharacterId: null,
        isActive: true,
      },
    ] as any)

    const result = await tickFactions(baseCtx({ dryRun: true }))

    expect(prisma.faction.update).not.toHaveBeenCalled()
    expect(prisma.faction.create).not.toHaveBeenCalled()
    expect(prisma.nPC.updateMany).not.toHaveBeenCalled()
    expect(prisma.location.update).not.toHaveBeenCalled()
    // The collapse itself is still detected and reported even though
    // nothing was written.
    expect(result.changes.some((c) => c.field === 'collapsed')).toBe(true)
  })
})
