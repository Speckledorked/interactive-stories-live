import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    worldMeta: { findUnique: vi.fn() },
    faction: { findMany: vi.fn(), update: vi.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import { tickSeasonalPressure, SEASON_MODIFIERS } from '../seasonTick'
import type { TickContext } from '../types'
import { DEFAULT_CALENDAR } from '../../calendar'

function baseCtx(overrides: Partial<TickContext> = {}): TickContext {
  return { campaignId: 'campaign-1', turnNumber: 5, factionCap: 10, npcCap: 20, dryRun: false, db: prisma as any, ...overrides }
}

// DEFAULT_CALENDAR: 12 x 30-day months. Month 0-2 spring, 3-5 summer,
// 6-8 autumn (harvest), 9-11 winter — see calendar.test.ts's deriveSeason
// coverage for the underlying math.
const HOURS_IN_AUTUMN = 24 * 30 * 6
const HOURS_IN_WINTER = 24 * 30 * 9
const HOURS_IN_SPRING = 0

function makeWorldMeta(totalElapsedGameHours: number, calendarConfig: unknown = DEFAULT_CALENDAR) {
  return { totalElapsedGameHours, campaign: { calendarConfig } }
}

describe('SEASON_MODIFIERS', () => {
  it('is the closed two-knob table decided for #118, nothing else', () => {
    expect(Object.keys(SEASON_MODIFIERS).sort()).toEqual(['autumn', 'spring', 'summer', 'winter'])
    for (const modifier of Object.values(SEASON_MODIFIERS)) {
      expect(Object.keys(modifier).sort()).toEqual(['clockSpeedMultiplier', 'resourceRegenDelta'])
    }
  })

  it('boosts resources and quickens clocks in autumn (harvest)', () => {
    expect(SEASON_MODIFIERS.autumn.resourceRegenDelta).toBeGreaterThan(0)
    expect(SEASON_MODIFIERS.autumn.clockSpeedMultiplier).toBeGreaterThan(1)
  })

  it('strains resources and slows clocks in winter', () => {
    expect(SEASON_MODIFIERS.winter.resourceRegenDelta).toBeLessThan(0)
    expect(SEASON_MODIFIERS.winter.clockSpeedMultiplier).toBeLessThan(1)
  })

  it('sits at the neutral baseline in spring and summer', () => {
    expect(SEASON_MODIFIERS.spring).toEqual({ resourceRegenDelta: 0, clockSpeedMultiplier: 1 })
    expect(SEASON_MODIFIERS.summer).toEqual({ resourceRegenDelta: 0, clockSpeedMultiplier: 1 })
  })
})

describe('tickSeasonalPressure', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does nothing and skips the faction query entirely at the spring/summer baseline', async () => {
    vi.mocked(prisma.worldMeta.findUnique).mockResolvedValueOnce(makeWorldMeta(HOURS_IN_SPRING) as any)

    const result = await tickSeasonalPressure(baseCtx())

    expect(prisma.faction.findMany).not.toHaveBeenCalled()
    expect(result.changes).toEqual([])
  })

  it('boosts active factions\' resources in autumn', async () => {
    vi.mocked(prisma.worldMeta.findUnique).mockResolvedValueOnce(makeWorldMeta(HOURS_IN_AUTUMN) as any)
    vi.mocked(prisma.faction.findMany).mockResolvedValueOnce([
      { id: 'f1', name: 'The Rustwatch', resources: 50 },
    ] as any)

    const result = await tickSeasonalPressure(baseCtx())

    expect(prisma.faction.update).toHaveBeenCalledWith({
      where: { id: 'f1' },
      data: { resources: 50 + SEASON_MODIFIERS.autumn.resourceRegenDelta },
    })
    expect(result.changes).toHaveLength(1)
    expect(result.changes[0].newValue).toBe(50 + SEASON_MODIFIERS.autumn.resourceRegenDelta)
  })

  it('strains active factions\' resources in winter', async () => {
    vi.mocked(prisma.worldMeta.findUnique).mockResolvedValueOnce(makeWorldMeta(HOURS_IN_WINTER) as any)
    vi.mocked(prisma.faction.findMany).mockResolvedValueOnce([
      { id: 'f1', name: 'The Rustwatch', resources: 50 },
    ] as any)

    const result = await tickSeasonalPressure(baseCtx())

    expect(prisma.faction.update).toHaveBeenCalledWith({
      where: { id: 'f1' },
      data: { resources: 50 + SEASON_MODIFIERS.winter.resourceRegenDelta },
    })
    expect(result.changes).toHaveLength(1)
  })

  it('clamps resources at 0 rather than going negative in winter', async () => {
    vi.mocked(prisma.worldMeta.findUnique).mockResolvedValueOnce(makeWorldMeta(HOURS_IN_WINTER) as any)
    vi.mocked(prisma.faction.findMany).mockResolvedValueOnce([
      { id: 'f1', name: 'The Rustwatch', resources: 1 },
    ] as any)

    const result = await tickSeasonalPressure(baseCtx())

    expect(result.changes[0].newValue).toBe(0)
  })

  it('skips a faction already clamped, rather than writing a no-op update', async () => {
    vi.mocked(prisma.worldMeta.findUnique).mockResolvedValueOnce(makeWorldMeta(HOURS_IN_WINTER) as any)
    vi.mocked(prisma.faction.findMany).mockResolvedValueOnce([
      { id: 'f1', name: 'Already Broke', resources: 0 },
    ] as any)

    const result = await tickSeasonalPressure(baseCtx())

    expect(prisma.faction.update).not.toHaveBeenCalled()
    expect(result.changes).toEqual([])
  })

  it('writes nothing at all in dry-run mode but still reports the changes', async () => {
    vi.mocked(prisma.worldMeta.findUnique).mockResolvedValueOnce(makeWorldMeta(HOURS_IN_AUTUMN) as any)
    vi.mocked(prisma.faction.findMany).mockResolvedValueOnce([
      { id: 'f1', name: 'The Rustwatch', resources: 50 },
    ] as any)

    const result = await tickSeasonalPressure(baseCtx({ dryRun: true }))

    expect(prisma.faction.update).not.toHaveBeenCalled()
    expect(result.changes).toHaveLength(1)
  })

  it('falls back to DEFAULT_CALENDAR when the campaign has no calendarConfig', async () => {
    vi.mocked(prisma.worldMeta.findUnique).mockResolvedValueOnce(makeWorldMeta(HOURS_IN_AUTUMN, null) as any)
    vi.mocked(prisma.faction.findMany).mockResolvedValueOnce([
      { id: 'f1', name: 'The Rustwatch', resources: 50 },
    ] as any)

    const result = await tickSeasonalPressure(baseCtx())

    expect(result.changes).toHaveLength(1)
  })

  it('returns no changes when the campaign has no WorldMeta row', async () => {
    vi.mocked(prisma.worldMeta.findUnique).mockResolvedValueOnce(null as any)

    const result = await tickSeasonalPressure(baseCtx())

    expect(result.changes).toEqual([])
    expect(prisma.faction.findMany).not.toHaveBeenCalled()
  })
})
