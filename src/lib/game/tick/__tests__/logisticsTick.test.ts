import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    location: { findMany: vi.fn() },
    supplyRoute: { findMany: vi.fn(), update: vi.fn(), create: vi.fn() },
    locationAdjacency: { findMany: vi.fn() },
    war: { findMany: vi.fn() },
    faction: { findUnique: vi.fn(), update: vi.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import { decideExtraction, decideSupplyRouteCreation, tickLogistics } from '../logisticsTick'
import type { TickContext } from '../types'

function baseCtx(overrides: Partial<TickContext> = {}): TickContext {
  return { campaignId: 'campaign-1', turnNumber: 5, factionCap: 10, npcCap: 20, dryRun: false, db: prisma as any, ...overrides }
}

describe('decideExtraction (#106, #108 follow-up)', () => {
  it('yields nothing for a location with no resource slots', () => {
    const result = decideExtraction(
      [{ locationId: 'loc1', resourceSlots: [], ownerFactionId: 'f1' }],
      []
    )
    expect(result).toEqual([])
  })

  it('yields nothing for an unowned resource location', () => {
    const result = decideExtraction(
      [{ locationId: 'loc1', resourceSlots: ['ore'], ownerFactionId: null }],
      []
    )
    expect(result).toEqual([])
  })

  it('is self-sufficient when the faction owns no other location — no route needed at all', () => {
    const result = decideExtraction(
      [{ locationId: 'loc1', resourceSlots: ['ore'], ownerFactionId: 'f1' }],
      []
    )
    expect(result).toEqual([{ locationId: 'loc1', factionId: 'f1', resourceGain: 2 }])
  })

  it('yields nothing when the faction owns a second location but no route connects them', () => {
    const result = decideExtraction(
      [
        { locationId: 'loc1', resourceSlots: ['ore'], ownerFactionId: 'f1' },
        { locationId: 'loc2', resourceSlots: [], ownerFactionId: 'f1' },
      ],
      []
    )
    expect(result).toEqual([])
  })

  it('yields nothing when the only touching route\'s other end is not owned by the same faction', () => {
    // loc3 isn't in the locations list at all — an unknown/unowned endpoint,
    // exactly the "reaches the faction's core" gap #108 was meant to close.
    const result = decideExtraction(
      [
        { locationId: 'loc1', resourceSlots: ['ore'], ownerFactionId: 'f1' },
        { locationId: 'loc2', resourceSlots: [], ownerFactionId: 'f1' },
      ],
      [{ fromLocationId: 'loc1', toLocationId: 'loc3', isBlockaded: false }]
    )
    expect(result).toEqual([])
  })

  it('yields nothing when the only same-faction-connected route is blockaded', () => {
    const result = decideExtraction(
      [
        { locationId: 'loc1', resourceSlots: ['ore'], ownerFactionId: 'f1' },
        { locationId: 'loc2', resourceSlots: [], ownerFactionId: 'f1' },
      ],
      [{ fromLocationId: 'loc1', toLocationId: 'loc2', isBlockaded: true }]
    )
    expect(result).toEqual([])
  })

  it('yields a gain when an unblockaded route connects to another same-faction location as the "from" end', () => {
    const result = decideExtraction(
      [
        { locationId: 'loc1', resourceSlots: ['ore'], ownerFactionId: 'f1' },
        { locationId: 'loc2', resourceSlots: [], ownerFactionId: 'f1' },
      ],
      [{ fromLocationId: 'loc1', toLocationId: 'loc2', isBlockaded: false }]
    )
    expect(result).toEqual([{ locationId: 'loc1', factionId: 'f1', resourceGain: 2 }])
  })

  it('yields a gain when an unblockaded route connects to another same-faction location as the "to" end', () => {
    const result = decideExtraction(
      [
        { locationId: 'loc1', resourceSlots: ['ore'], ownerFactionId: 'f1' },
        { locationId: 'loc2', resourceSlots: [], ownerFactionId: 'f1' },
      ],
      [{ fromLocationId: 'loc2', toLocationId: 'loc1', isBlockaded: false }]
    )
    expect(result).toEqual([{ locationId: 'loc1', factionId: 'f1', resourceGain: 2 }])
  })

  it('scales the gain with the number of resource slots', () => {
    const result = decideExtraction(
      [
        { locationId: 'loc1', resourceSlots: ['ore', 'lumber', 'grain'], ownerFactionId: 'f1' },
        { locationId: 'loc2', resourceSlots: [], ownerFactionId: 'f1' },
      ],
      [{ fromLocationId: 'loc1', toLocationId: 'loc2', isBlockaded: false }]
    )
    expect(result[0].resourceGain).toBe(6)
  })

  it('still yields when at least one of several routes is unblockaded and same-faction-connected', () => {
    const result = decideExtraction(
      [
        { locationId: 'loc1', resourceSlots: ['ore'], ownerFactionId: 'f1' },
        { locationId: 'loc2', resourceSlots: [], ownerFactionId: 'f1' },
        { locationId: 'loc3', resourceSlots: [], ownerFactionId: 'f1' },
      ],
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
        { locationId: 'hub1', resourceSlots: [], ownerFactionId: 'f1' },
        { locationId: 'loc2', resourceSlots: ['lumber'], ownerFactionId: 'f2' },
        { locationId: 'hub2', resourceSlots: [], ownerFactionId: 'f2' },
      ],
      [
        { fromLocationId: 'loc1', toLocationId: 'hub1', isBlockaded: false },
        { fromLocationId: 'loc2', toLocationId: 'hub2', isBlockaded: true },
      ]
    )
    expect(result).toEqual([{ locationId: 'loc1', factionId: 'f1', resourceGain: 2 }])
  })
})

describe('decideSupplyRouteCreation (#108 follow-up)', () => {
  it('creates nothing for a location with no resource slots', () => {
    expect(
      decideSupplyRouteCreation([{ locationId: 'loc1', resourceSlots: [], ownerFactionId: 'f1' }], [], [])
    ).toEqual([])
  })

  it('creates nothing for an unowned resource location', () => {
    expect(
      decideSupplyRouteCreation([{ locationId: 'loc1', resourceSlots: ['ore'], ownerFactionId: null }], [], [])
    ).toEqual([])
  })

  it('creates nothing when a working route already exists', () => {
    const locations = [
      { locationId: 'loc1', resourceSlots: ['ore'], ownerFactionId: 'f1' },
      { locationId: 'loc2', resourceSlots: [], ownerFactionId: 'f1' },
    ]
    const routes = [{ fromLocationId: 'loc1', toLocationId: 'loc2', isBlockaded: false }]
    expect(decideSupplyRouteCreation(locations, routes, [])).toEqual([])
  })

  it('creates nothing when the existing route is merely blockaded, not missing — a siege needs lifting, not a duplicate route built alongside it', () => {
    const locations = [
      { locationId: 'loc1', resourceSlots: ['ore'], ownerFactionId: 'f1' },
      { locationId: 'loc2', resourceSlots: [], ownerFactionId: 'f1' },
    ]
    const routes = [{ fromLocationId: 'loc1', toLocationId: 'loc2', isBlockaded: true }]
    expect(decideSupplyRouteCreation(locations, routes, [])).toEqual([])
  })

  it('creates nothing when the faction owns no other location (self-sufficient)', () => {
    expect(
      decideSupplyRouteCreation([{ locationId: 'loc1', resourceSlots: ['ore'], ownerFactionId: 'f1' }], [], [])
    ).toEqual([])
  })

  it('connects to the nearest other same-faction location via the real adjacency graph', () => {
    const locations = [
      { locationId: 'loc1', resourceSlots: ['ore'], ownerFactionId: 'f1' },
      { locationId: 'far', resourceSlots: [], ownerFactionId: 'f1' },
      { locationId: 'near', resourceSlots: [], ownerFactionId: 'f1' },
    ]
    const edges = [
      { locationAId: 'loc1', locationBId: 'near', distance: 1 },
      { locationAId: 'loc1', locationBId: 'mid', distance: 1 },
      { locationAId: 'mid', locationBId: 'far', distance: 1 },
    ]
    const result = decideSupplyRouteCreation(locations, [], edges)
    expect(result).toEqual([{ fromLocationId: 'loc1', toLocationId: 'near', controllingFactionId: 'f1' }])
  })

  it('falls back to an arbitrary-but-deterministic other owned location when no graph data covers it', () => {
    const locations = [
      { locationId: 'loc1', resourceSlots: ['ore'], ownerFactionId: 'f1' },
      { locationId: 'zzz', resourceSlots: [], ownerFactionId: 'f1' },
      { locationId: 'aaa', resourceSlots: [], ownerFactionId: 'f1' },
    ]
    const result = decideSupplyRouteCreation(locations, [], [])
    expect(result).toEqual([{ fromLocationId: 'loc1', toLocationId: 'aaa', controllingFactionId: 'f1' }])
  })

  it('still creates a route when only another faction\'s route touches the location', () => {
    const locations = [
      { locationId: 'loc1', resourceSlots: ['ore'], ownerFactionId: 'f1' },
      { locationId: 'loc2', resourceSlots: [], ownerFactionId: 'f1' },
    ]
    // Route exists and touches loc1, but its other end belongs to no one
    // f1 owns — doesn't count as "already connected."
    const routes = [{ fromLocationId: 'loc1', toLocationId: 'someone-elses-place', isBlockaded: false }]
    const result = decideSupplyRouteCreation(locations, routes, [])
    expect(result).toEqual([{ fromLocationId: 'loc1', toLocationId: 'loc2', controllingFactionId: 'f1' }])
  })

  // #246 (adversarial audit re-pass): two resource locations that are each
  // other's nearest neighbor, both starting with no route at all, used to
  // each independently decide to connect to the other — two SupplyRoute
  // rows for the same pair created in one tick, since hasAnyConnection only
  // ever checks the routes that existed BEFORE this pass, not a decision
  // this same pass already made for the other end.
  it('creates only one route, not two, when two resource locations are mutually each other\'s nearest neighbor', () => {
    const locations = [
      { locationId: 'A', resourceSlots: ['ore'], ownerFactionId: 'f1' },
      { locationId: 'B', resourceSlots: ['ore'], ownerFactionId: 'f1' },
    ]
    const edges = [{ locationAId: 'A', locationBId: 'B', distance: 1 }]
    const result = decideSupplyRouteCreation(locations, [], edges)
    expect(result).toEqual([{ fromLocationId: 'A', toLocationId: 'B', controllingFactionId: 'f1' }])
  })

  it('the same mutual-neighbor case still resolves correctly with three resource locations all needing routes', () => {
    const locations = [
      { locationId: 'A', resourceSlots: ['ore'], ownerFactionId: 'f1' },
      { locationId: 'B', resourceSlots: ['ore'], ownerFactionId: 'f1' },
      { locationId: 'C', resourceSlots: ['ore'], ownerFactionId: 'f1' },
    ]
    // A-B are mutual nearest; C's only edge is to A.
    const edges = [
      { locationAId: 'A', locationBId: 'B', distance: 1 },
      { locationAId: 'A', locationBId: 'C', distance: 5 },
    ]
    const result = decideSupplyRouteCreation(locations, [], edges)
    // A<->B forms one route (mutual-neighbor dedup); C still gets its own,
    // since it was never marked connected by anyone else's decision.
    expect(result).toEqual([
      { fromLocationId: 'A', toLocationId: 'B', controllingFactionId: 'f1' },
      { fromLocationId: 'C', toLocationId: 'A', controllingFactionId: 'f1' },
    ])
  })
})

describe('tickLogistics (DB handler)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.locationAdjacency.findMany).mockResolvedValue([])
  })

  it('does nothing when the campaign has no locations', async () => {
    vi.mocked(prisma.location.findMany).mockResolvedValueOnce([])
    const result = await tickLogistics(baseCtx())
    expect(result.changes).toEqual([])
    expect(prisma.supplyRoute.findMany).not.toHaveBeenCalled()
  })

  it('grants extraction to a lone owned resource location with no route needed', async () => {
    vi.mocked(prisma.location.findMany).mockResolvedValueOnce([
      { id: 'loc1', name: 'Ore Hills', resourceSlots: ['ore'], ownerFactionId: 'f1' },
    ] as any)
    vi.mocked(prisma.supplyRoute.findMany).mockResolvedValueOnce([])
    vi.mocked(prisma.war.findMany).mockResolvedValueOnce([])
    vi.mocked(prisma.faction.findUnique).mockResolvedValueOnce({ id: 'f1', name: 'Ashcrown', resources: 50, isActive: true } as any)

    const result = await tickLogistics(baseCtx())

    expect(prisma.supplyRoute.create).not.toHaveBeenCalled()
    expect(prisma.faction.update).toHaveBeenCalledWith({ where: { id: 'f1' }, data: { resources: 52 } })
    expect(result.changes).toHaveLength(1)
  })

  it('auto-creates a connecting route for a two-location faction and extracts the same tick', async () => {
    vi.mocked(prisma.location.findMany).mockResolvedValueOnce([
      { id: 'loc1', name: 'Ore Hills', resourceSlots: ['ore'], ownerFactionId: 'f1' },
      { id: 'loc2', name: 'Ashcrown Hold', resourceSlots: [], ownerFactionId: 'f1' },
    ] as any)
    vi.mocked(prisma.supplyRoute.findMany).mockResolvedValueOnce([])
    vi.mocked(prisma.supplyRoute.create).mockResolvedValueOnce({
      id: 'new-route', fromLocationId: 'loc1', toLocationId: 'loc2', isBlockaded: false,
    } as any)
    vi.mocked(prisma.war.findMany).mockResolvedValueOnce([])
    vi.mocked(prisma.faction.findUnique).mockResolvedValueOnce({ id: 'f1', name: 'Ashcrown', resources: 50, isActive: true } as any)

    const result = await tickLogistics(baseCtx())

    expect(prisma.supplyRoute.create).toHaveBeenCalledWith({
      data: { campaignId: 'campaign-1', fromLocationId: 'loc1', toLocationId: 'loc2', controllingFactionId: 'f1' },
      select: { id: true, fromLocationId: true, toLocationId: true, isBlockaded: true },
    })
    expect(prisma.faction.update).toHaveBeenCalledWith({ where: { id: 'f1' }, data: { resources: 52 } })
    expect(result.changes).toHaveLength(1)
  })

  it('does not create a route in dry-run mode, but still previews the extraction it would enable', async () => {
    vi.mocked(prisma.location.findMany).mockResolvedValueOnce([
      { id: 'loc1', name: 'Ore Hills', resourceSlots: ['ore'], ownerFactionId: 'f1' },
      { id: 'loc2', name: 'Ashcrown Hold', resourceSlots: [], ownerFactionId: 'f1' },
    ] as any)
    vi.mocked(prisma.supplyRoute.findMany).mockResolvedValueOnce([])
    vi.mocked(prisma.war.findMany).mockResolvedValueOnce([])
    vi.mocked(prisma.faction.findUnique).mockResolvedValueOnce({ id: 'f1', name: 'Ashcrown', resources: 50, isActive: true } as any)

    const result = await tickLogistics(baseCtx({ dryRun: true }))

    expect(prisma.supplyRoute.create).not.toHaveBeenCalled()
    expect(prisma.faction.update).not.toHaveBeenCalled()
    expect(result.changes).toHaveLength(1)
  })

  it('sums extraction from multiple owned locations into one faction update', async () => {
    vi.mocked(prisma.location.findMany).mockResolvedValueOnce([
      { id: 'loc1', name: 'Ore Hills', resourceSlots: ['ore'], ownerFactionId: 'f1' },
      { id: 'loc2', name: 'Timber Vale', resourceSlots: ['lumber'], ownerFactionId: 'f1' },
    ] as any)
    vi.mocked(prisma.supplyRoute.findMany).mockResolvedValueOnce([
      { id: 'route1', fromLocationId: 'loc1', toLocationId: 'loc2', isBlockaded: false },
    ] as any)
    vi.mocked(prisma.war.findMany).mockResolvedValueOnce([])
    vi.mocked(prisma.faction.findUnique).mockResolvedValueOnce({ id: 'f1', name: 'Ashcrown', resources: 50, isActive: true } as any)

    await tickLogistics(baseCtx())

    // loc1 and loc2 connect directly to each other, so both count as
    // routed — 2 (ore) + 2 (lumber) = 4.
    expect(prisma.faction.update).toHaveBeenCalledWith({ where: { id: 'f1' }, data: { resources: 54 } })
  })

  it('skips a faction that has since collapsed', async () => {
    vi.mocked(prisma.location.findMany).mockResolvedValueOnce([
      { id: 'loc1', name: 'Ore Hills', resourceSlots: ['ore'], ownerFactionId: 'f1' },
    ] as any)
    vi.mocked(prisma.supplyRoute.findMany).mockResolvedValueOnce([])
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
    vi.mocked(prisma.supplyRoute.findMany).mockResolvedValueOnce([])
    vi.mocked(prisma.war.findMany).mockResolvedValueOnce([])
    vi.mocked(prisma.faction.findUnique).mockResolvedValueOnce({ id: 'f1', name: 'Ashcrown', resources: 99, isActive: true } as any)

    await tickLogistics(baseCtx())

    expect(prisma.faction.update).toHaveBeenCalledWith({ where: { id: 'f1' }, data: { resources: 100 } })
  })

  it('blockades a route touching a location currently sieged by an ESCALATING war', async () => {
    vi.mocked(prisma.location.findMany).mockResolvedValueOnce([
      { id: 'loc1', name: 'Ore Hills', resourceSlots: ['ore'], ownerFactionId: 'f1' },
      { id: 'loc2', name: 'Ashcrown Hold', resourceSlots: [], ownerFactionId: 'f1' },
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
      { id: 'loc2', name: 'Ashcrown Hold', resourceSlots: [], ownerFactionId: 'f1' },
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
      { id: 'loc2', name: 'Ashcrown Hold', resourceSlots: [], ownerFactionId: 'f1' },
    ] as any)
    vi.mocked(prisma.supplyRoute.findMany).mockResolvedValueOnce([
      { id: 'route1', fromLocationId: 'loc1', toLocationId: 'loc2', isBlockaded: true },
    ] as any)
    vi.mocked(prisma.war.findMany).mockResolvedValueOnce([{ contestedLocationId: 'loc1' }] as any)

    await tickLogistics(baseCtx())

    expect(prisma.supplyRoute.update).not.toHaveBeenCalled()
  })
})
