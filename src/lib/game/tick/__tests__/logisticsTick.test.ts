import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    location: { findMany: vi.fn() },
    supplyRoute: { findMany: vi.fn(), update: vi.fn() },
    war: { findMany: vi.fn() },
    faction: { findUnique: vi.fn(), update: vi.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import { decideExtraction, tickLogistics } from '../logisticsTick'
import type { TickContext } from '../types'

function baseCtx(overrides: Partial<TickContext> = {}): TickContext {
  return { campaignId: 'campaign-1', turnNumber: 5, factionCap: 10, npcCap: 20, dryRun: false, db: prisma as any, ...overrides }
}

describe('decideExtraction (#106)', () => {
  it('yields nothing for a location with no resource slots', () => {
    const result = decideExtraction(
      [{ locationId: 'loc1', resourceSlots: [], ownerFactionId: 'f1' }],
      [{ fromLocationId: 'loc1', toLocationId: 'loc2', isBlockaded: false }]
    )
    expect(result).toEqual([])
  })

  it('yields nothing for an unowned resource location', () => {
    const result = decideExtraction(
      [{ locationId: 'loc1', resourceSlots: ['ore'], ownerFactionId: null }],
      [{ fromLocationId: 'loc1', toLocationId: 'loc2', isBlockaded: false }]
    )
    expect(result).toEqual([])
  })

  it('yields nothing when no route touches the location at all', () => {
    const result = decideExtraction(
      [{ locationId: 'loc1', resourceSlots: ['ore'], ownerFactionId: 'f1' }],
      [{ fromLocationId: 'loc2', toLocationId: 'loc3', isBlockaded: false }]
    )
    expect(result).toEqual([])
  })

  it('yields nothing when the only touching route is blockaded', () => {
    const result = decideExtraction(
      [{ locationId: 'loc1', resourceSlots: ['ore'], ownerFactionId: 'f1' }],
      [{ fromLocationId: 'loc1', toLocationId: 'loc2', isBlockaded: true }]
    )
    expect(result).toEqual([])
  })

  it('yields a gain when an unblockaded route touches the location as the "from" end', () => {
    const result = decideExtraction(
      [{ locationId: 'loc1', resourceSlots: ['ore'], ownerFactionId: 'f1' }],
      [{ fromLocationId: 'loc1', toLocationId: 'loc2', isBlockaded: false }]
    )
    expect(result).toEqual([{ locationId: 'loc1', factionId: 'f1', resourceGain: 2 }])
  })

  it('yields a gain when an unblockaded route touches the location as the "to" end', () => {
    const result = decideExtraction(
      [{ locationId: 'loc1', resourceSlots: ['ore'], ownerFactionId: 'f1' }],
      [{ fromLocationId: 'loc2', toLocationId: 'loc1', isBlockaded: false }]
    )
    expect(result).toEqual([{ locationId: 'loc1', factionId: 'f1', resourceGain: 2 }])
  })

  it('scales the gain with the number of resource slots', () => {
    const result = decideExtraction(
      [{ locationId: 'loc1', resourceSlots: ['ore', 'lumber', 'grain'], ownerFactionId: 'f1' }],
      [{ fromLocationId: 'loc1', toLocationId: 'loc2', isBlockaded: false }]
    )
    expect(result[0].resourceGain).toBe(6)
  })

  it('still yields when at least one of several routes is unblockaded', () => {
    const result = decideExtraction(
      [{ locationId: 'loc1', resourceSlots: ['ore'], ownerFactionId: 'f1' }],
      [
        { fromLocationId: 'loc1', toLocationId: 'loc2', isBlockaded: true },
        { fromLocationId: 'loc1', toLocationId: 'loc3', isBlockaded: false },
      ]
    )
    expect(result).toHaveLength(1)
  })

  it('handles multiple locations independently', () => {
    const result = decideExtraction(
      [
        { locationId: 'loc1', resourceSlots: ['ore'], ownerFactionId: 'f1' },
        { locationId: 'loc2', resourceSlots: ['lumber'], ownerFactionId: 'f2' },
      ],
      [
        { fromLocationId: 'loc1', toLocationId: 'x', isBlockaded: false },
        { fromLocationId: 'loc2', toLocationId: 'y', isBlockaded: true },
      ]
    )
    expect(result).toEqual([{ locationId: 'loc1', factionId: 'f1', resourceGain: 2 }])
  })
})

describe('tickLogistics (DB handler)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does nothing when the campaign has no locations', async () => {
    vi.mocked(prisma.location.findMany).mockResolvedValueOnce([])
    const result = await tickLogistics(baseCtx())
    expect(result.changes).toEqual([])
    expect(prisma.supplyRoute.findMany).not.toHaveBeenCalled()
  })

  it('does nothing when no location has a working route', async () => {
    vi.mocked(prisma.location.findMany).mockResolvedValueOnce([
      { id: 'loc1', name: 'Ore Hills', resourceSlots: ['ore'], ownerFactionId: 'f1' },
    ] as any)
    vi.mocked(prisma.supplyRoute.findMany).mockResolvedValueOnce([])
    vi.mocked(prisma.war.findMany).mockResolvedValueOnce([])

    const result = await tickLogistics(baseCtx())

    expect(result.changes).toEqual([])
    expect(prisma.faction.findUnique).not.toHaveBeenCalled()
  })

  it('grants a faction resources from a worked, connected location', async () => {
    vi.mocked(prisma.location.findMany).mockResolvedValueOnce([
      { id: 'loc1', name: 'Ore Hills', resourceSlots: ['ore'], ownerFactionId: 'f1' },
    ] as any)
    vi.mocked(prisma.supplyRoute.findMany).mockResolvedValueOnce([
      { id: 'route1', fromLocationId: 'loc1', toLocationId: 'loc2', isBlockaded: false },
    ] as any)
    vi.mocked(prisma.war.findMany).mockResolvedValueOnce([])
    vi.mocked(prisma.faction.findUnique).mockResolvedValueOnce({ id: 'f1', name: 'Ashcrown', resources: 50, isActive: true } as any)

    const result = await tickLogistics(baseCtx())

    expect(prisma.faction.update).toHaveBeenCalledWith({ where: { id: 'f1' }, data: { resources: 52 } })
    expect(result.changes).toHaveLength(1)
    expect(result.changes[0]).toMatchObject({ entityType: 'FACTION', entityId: 'f1', field: 'resources', significant: false, importance: 'NORMAL' })
  })

  it('sums extraction from multiple owned locations into one faction update', async () => {
    vi.mocked(prisma.location.findMany).mockResolvedValueOnce([
      { id: 'loc1', name: 'Ore Hills', resourceSlots: ['ore'], ownerFactionId: 'f1' },
      { id: 'loc2', name: 'Timber Vale', resourceSlots: ['lumber'], ownerFactionId: 'f1' },
    ] as any)
    vi.mocked(prisma.supplyRoute.findMany).mockResolvedValueOnce([
      { id: 'route1', fromLocationId: 'loc1', toLocationId: 'hub', isBlockaded: false },
      { id: 'route2', fromLocationId: 'loc2', toLocationId: 'hub', isBlockaded: false },
    ] as any)
    vi.mocked(prisma.war.findMany).mockResolvedValueOnce([])
    vi.mocked(prisma.faction.findUnique).mockResolvedValueOnce({ id: 'f1', name: 'Ashcrown', resources: 50, isActive: true } as any)

    await tickLogistics(baseCtx())

    expect(prisma.faction.update).toHaveBeenCalledWith({ where: { id: 'f1' }, data: { resources: 54 } })
  })

  it('skips a faction that has since collapsed', async () => {
    vi.mocked(prisma.location.findMany).mockResolvedValueOnce([
      { id: 'loc1', name: 'Ore Hills', resourceSlots: ['ore'], ownerFactionId: 'f1' },
    ] as any)
    vi.mocked(prisma.supplyRoute.findMany).mockResolvedValueOnce([
      { id: 'route1', fromLocationId: 'loc1', toLocationId: 'loc2', isBlockaded: false },
    ] as any)
    vi.mocked(prisma.war.findMany).mockResolvedValueOnce([])
    vi.mocked(prisma.faction.findUnique).mockResolvedValueOnce({ id: 'f1', name: 'Ashcrown', resources: 50, isActive: false } as any)

    const result = await tickLogistics(baseCtx())

    expect(prisma.faction.update).not.toHaveBeenCalled()
    expect(result.changes).toEqual([])
  })

  it('caps the gain at 100 rather than exceeding it', async () => {
    vi.mocked(prisma.location.findMany).mockResolvedValueOnce([
      { id: 'loc1', name: 'Ore Hills', resourceSlots: ['ore'], ownerFactionId: 'f1' },
    ] as any)
    vi.mocked(prisma.supplyRoute.findMany).mockResolvedValueOnce([
      { id: 'route1', fromLocationId: 'loc1', toLocationId: 'loc2', isBlockaded: false },
    ] as any)
    vi.mocked(prisma.war.findMany).mockResolvedValueOnce([])
    vi.mocked(prisma.faction.findUnique).mockResolvedValueOnce({ id: 'f1', name: 'Ashcrown', resources: 99, isActive: true } as any)

    await tickLogistics(baseCtx())

    expect(prisma.faction.update).toHaveBeenCalledWith({ where: { id: 'f1' }, data: { resources: 100 } })
  })

  it('blockades a route touching a location currently sieged by an ESCALATING war', async () => {
    vi.mocked(prisma.location.findMany).mockResolvedValueOnce([
      { id: 'loc1', name: 'Ore Hills', resourceSlots: ['ore'], ownerFactionId: 'f1' },
    ] as any)
    vi.mocked(prisma.supplyRoute.findMany).mockResolvedValueOnce([
      { id: 'route1', fromLocationId: 'loc1', toLocationId: 'loc2', isBlockaded: false },
    ] as any)
    vi.mocked(prisma.war.findMany).mockResolvedValueOnce([{ contestedLocationId: 'loc1' }] as any)

    const result = await tickLogistics(baseCtx())

    expect(prisma.supplyRoute.update).toHaveBeenCalledWith({ where: { id: 'route1' }, data: { isBlockaded: true } })
    // The route is blockaded THIS tick, so no extraction happens this turn.
    expect(prisma.faction.findUnique).not.toHaveBeenCalled()
    expect(result.changes).toEqual([])
  })

  it('lifts a blockade once its war is no longer ESCALATING', async () => {
    vi.mocked(prisma.location.findMany).mockResolvedValueOnce([
      { id: 'loc1', name: 'Ore Hills', resourceSlots: ['ore'], ownerFactionId: 'f1' },
    ] as any)
    vi.mocked(prisma.supplyRoute.findMany).mockResolvedValueOnce([
      { id: 'route1', fromLocationId: 'loc1', toLocationId: 'loc2', isBlockaded: true },
    ] as any)
    vi.mocked(prisma.war.findMany).mockResolvedValueOnce([]) // no longer escalating
    vi.mocked(prisma.faction.findUnique).mockResolvedValueOnce({ id: 'f1', name: 'Ashcrown', resources: 50, isActive: true } as any)

    await tickLogistics(baseCtx())

    expect(prisma.supplyRoute.update).toHaveBeenCalledWith({ where: { id: 'route1' }, data: { isBlockaded: false } })
    // Lifted the same tick, so extraction also happens this same turn.
    expect(prisma.faction.update).toHaveBeenCalledWith({ where: { id: 'f1' }, data: { resources: 52 } })
  })

  it('does not touch a route whose blockade state is already correct', async () => {
    vi.mocked(prisma.location.findMany).mockResolvedValueOnce([
      { id: 'loc1', name: 'Ore Hills', resourceSlots: ['ore'], ownerFactionId: 'f1' },
    ] as any)
    vi.mocked(prisma.supplyRoute.findMany).mockResolvedValueOnce([
      { id: 'route1', fromLocationId: 'loc1', toLocationId: 'loc2', isBlockaded: true },
    ] as any)
    vi.mocked(prisma.war.findMany).mockResolvedValueOnce([{ contestedLocationId: 'loc1' }] as any)

    await tickLogistics(baseCtx())

    expect(prisma.supplyRoute.update).not.toHaveBeenCalled()
  })

  it('writes nothing in dry-run mode but still reports the changes', async () => {
    vi.mocked(prisma.location.findMany).mockResolvedValueOnce([
      { id: 'loc1', name: 'Ore Hills', resourceSlots: ['ore'], ownerFactionId: 'f1' },
    ] as any)
    vi.mocked(prisma.supplyRoute.findMany).mockResolvedValueOnce([
      { id: 'route1', fromLocationId: 'loc1', toLocationId: 'loc2', isBlockaded: false },
    ] as any)
    vi.mocked(prisma.war.findMany).mockResolvedValueOnce([])
    vi.mocked(prisma.faction.findUnique).mockResolvedValueOnce({ id: 'f1', name: 'Ashcrown', resources: 50, isActive: true } as any)

    const result = await tickLogistics(baseCtx({ dryRun: true }))

    expect(prisma.supplyRoute.update).not.toHaveBeenCalled()
    expect(prisma.faction.update).not.toHaveBeenCalled()
    expect(result.changes).toHaveLength(1)
  })
})
