import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    location: { findMany: vi.fn(), update: vi.fn() },
    faction: { findMany: vi.fn(), findUnique: vi.fn() },
    arc: { create: vi.fn(), update: vi.fn() },
    war: { findMany: vi.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import { decideTerritoryLoyaltyPush, tickTerritoryLoyalty } from '../territoryLoyaltyTick'
import type { TickContext } from '../types'
import { factionTieRows } from './tieFixtures'
import { simTurn } from '@/lib/game/turnClock'

function baseCtx(overrides: Partial<TickContext> = {}): TickContext {
  return { campaignId: 'campaign-1', turnNumber: simTurn(10), factionCap: 10, npcCap: 20, dryRun: false, db: prisma as any, ...overrides }
}

describe('decideTerritoryLoyaltyPush (#119)', () => {
  it('is deterministic for the same arc id and turn number', () => {
    const a = decideTerritoryLoyaltyPush('loc1', 5, 0, 0, { military: 60 }, { military: 40 })
    const b = decideTerritoryLoyaltyPush('loc1', 5, 0, 0, { military: 60 }, { military: 40 })
    expect(a).toEqual(b)
  })

  it('does not resolve while under the decisive threshold and within the duration', () => {
    const result = decideTerritoryLoyaltyPush('loc1', 1, 10, 1, { military: 50 }, { military: 50 })
    expect(result.resolution.resolves).toBe(false)
  })

  it('resolves in favor of the owner once the value swings decisively positive', () => {
    const result = decideTerritoryLoyaltyPush('loc1', 1, 65, 1, { military: 50 }, { military: 50 })
    expect(result.resolution).toEqual({ resolves: true, winner: 'A' })
  })

  it('resolves in favor of the rival once the value swings decisively negative', () => {
    const result = decideTerritoryLoyaltyPush('loc1', 1, -70, 1, { military: 50 }, { military: 50 })
    expect(result.resolution).toEqual({ resolves: true, winner: 'B' })
  })

  it('resolves as a stalemate once the contest has dragged on 8 turns without a decisive swing', () => {
    const result = decideTerritoryLoyaltyPush('loc1', 1, 10, 8, { military: 50 }, { military: 50 })
    expect(result.resolution).toEqual({ resolves: true, winner: 'stalemate' })
  })

  it('pushes toward the stronger side over repeated ticks', () => {
    let value = 0
    for (let turn = 0; turn < 5; turn++) {
      const push = decideTerritoryLoyaltyPush('loc1', turn, value, turn, { military: 90 }, { military: 10 })
      value = push.newValue
    }
    expect(value).toBeGreaterThan(0)
  })
})

describe('tickTerritoryLoyalty (DB handler, #119)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: no ESCALATING war is contesting any location. Tests
    // specifically covering the #228 war-exclusion behavior override this.
    vi.mocked(prisma.war.findMany).mockResolvedValue([])
  })

  it('does nothing when no location is contested', async () => {
    vi.mocked(prisma.location.findMany).mockResolvedValueOnce([])

    const result = await tickTerritoryLoyalty(baseCtx())

    expect(result.changes).toEqual([])
    expect(prisma.faction.findMany).not.toHaveBeenCalled()
  })

  it('skips a contested location whose owner is not active', async () => {
    vi.mocked(prisma.location.findMany).mockResolvedValueOnce([
      { id: 'loc1', name: 'Ore Hills', ownerFactionId: 'f1', loyaltyArc: null },
    ] as any)
    vi.mocked(prisma.faction.findMany).mockResolvedValueOnce([])

    const result = await tickTerritoryLoyalty(baseCtx())

    expect(result.changes).toEqual([])
    expect(prisma.faction.findUnique).not.toHaveBeenCalled()
  })

  it('skips a location whose owner has no on-record rival', async () => {
    vi.mocked(prisma.location.findMany).mockResolvedValueOnce([
      { id: 'loc1', name: 'Ore Hills', ownerFactionId: 'f1', loyaltyArc: null },
    ] as any)
    vi.mocked(prisma.faction.findMany).mockResolvedValueOnce([
      { id: 'f1', name: 'Ashcrown', military: 50, ...factionTieRows('f1', {}) },
    ] as any)

    const result = await tickTerritoryLoyalty(baseCtx())

    expect(result.changes).toEqual([])
    expect(prisma.faction.findUnique).not.toHaveBeenCalled()
  })

  it('skips when the on-record rival has since collapsed', async () => {
    vi.mocked(prisma.location.findMany).mockResolvedValueOnce([
      { id: 'loc1', name: 'Ore Hills', ownerFactionId: 'f1', loyaltyArc: null },
    ] as any)
    vi.mocked(prisma.faction.findMany).mockResolvedValueOnce([
      { id: 'f1', name: 'Ashcrown', military: 50, ...factionTieRows('f1', { f2: { type: 'RIVAL', since: 1 } }) },
    ] as any)
    vi.mocked(prisma.faction.findUnique).mockResolvedValueOnce({ id: 'f2', name: 'Blackreach', military: 40, isActive: false } as any)

    const result = await tickTerritoryLoyalty(baseCtx())

    expect(result.changes).toEqual([])
    expect(prisma.arc.create).not.toHaveBeenCalled()
  })

  it('creates a fresh loyalty arc for a newly contested location with no prior push', async () => {
    vi.mocked(prisma.location.findMany).mockResolvedValueOnce([
      { id: 'loc1', name: 'Ore Hills', ownerFactionId: 'f1', loyaltyArc: null },
    ] as any)
    vi.mocked(prisma.faction.findMany).mockResolvedValueOnce([
      { id: 'f1', name: 'Ashcrown', military: 50, ...factionTieRows('f1', { f2: { type: 'RIVAL', since: 1 } }) },
    ] as any)
    vi.mocked(prisma.faction.findUnique).mockResolvedValueOnce({ id: 'f2', name: 'Blackreach', military: 30, isActive: true } as any)
    vi.mocked(prisma.arc.create).mockResolvedValueOnce({ id: 'arc1', value: 5 } as any)

    const result = await tickTerritoryLoyalty(baseCtx({ turnNumber: simTurn(10) }))

    expect(prisma.arc.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ campaignId: 'campaign-1', kind: 'TERRITORY_LOYALTY', locationId: 'loc1', startedTurn: 10 }),
    })
    // A routine, non-resolving push isn't narratively interesting on its own.
    expect(result.changes).toEqual([])
  })

  it('updates an existing loyalty arc rather than creating a new one', async () => {
    vi.mocked(prisma.location.findMany).mockResolvedValueOnce([
      { id: 'loc1', name: 'Ore Hills', ownerFactionId: 'f1', loyaltyArc: { id: 'arc1', value: 10, startedTurn: 5 } },
    ] as any)
    vi.mocked(prisma.faction.findMany).mockResolvedValueOnce([
      { id: 'f1', name: 'Ashcrown', military: 50, ...factionTieRows('f1', { f2: { type: 'RIVAL', since: 1 } }) },
    ] as any)
    vi.mocked(prisma.faction.findUnique).mockResolvedValueOnce({ id: 'f2', name: 'Blackreach', military: 50, isActive: true } as any)

    await tickTerritoryLoyalty(baseCtx({ turnNumber: simTurn(7) }))

    expect(prisma.arc.update).toHaveBeenCalledWith({ where: { id: 'arc1' }, data: { value: expect.any(Number) } })
    expect(prisma.arc.create).not.toHaveBeenCalled()
  })

  it('flips the location to the rival and logs a MAJOR change once the arc resolves decisively against the owner', async () => {
    vi.mocked(prisma.location.findMany).mockResolvedValueOnce([
      { id: 'loc1', name: 'Ore Hills', ownerFactionId: 'f1', loyaltyArc: { id: 'arc1', value: -55, startedTurn: 1 } },
    ] as any)
    vi.mocked(prisma.faction.findMany).mockResolvedValueOnce([
      { id: 'f1', name: 'Ashcrown', military: 10, ...factionTieRows('f1', { f2: { type: 'RIVAL', since: 1 } }) },
    ] as any)
    vi.mocked(prisma.faction.findUnique).mockResolvedValueOnce({ id: 'f2', name: 'Blackreach', military: 90, isActive: true } as any)

    const result = await tickTerritoryLoyalty(baseCtx({ turnNumber: simTurn(2) }))

    expect(prisma.location.update).toHaveBeenCalledWith({ where: { id: 'loc1' }, data: { ownerFactionId: 'f2', isContested: false } })
    expect(prisma.arc.update).toHaveBeenCalledWith({ where: { id: 'arc1' }, data: { value: 0 } })
    expect(result.changes).toHaveLength(1)
    expect(result.changes[0]).toMatchObject({ entityType: 'FACTION', entityId: 'f2', field: 'territoryClaimed', significant: true, importance: 'MAJOR' })
  })

  it('cements the owner\'s hold and clears the contest once the arc resolves decisively in their favor', async () => {
    vi.mocked(prisma.location.findMany).mockResolvedValueOnce([
      { id: 'loc1', name: 'Ore Hills', ownerFactionId: 'f1', loyaltyArc: { id: 'arc1', value: 55, startedTurn: 1 } },
    ] as any)
    vi.mocked(prisma.faction.findMany).mockResolvedValueOnce([
      { id: 'f1', name: 'Ashcrown', military: 90, ...factionTieRows('f1', { f2: { type: 'RIVAL', since: 1 } }) },
    ] as any)
    vi.mocked(prisma.faction.findUnique).mockResolvedValueOnce({ id: 'f2', name: 'Blackreach', military: 10, isActive: true } as any)

    const result = await tickTerritoryLoyalty(baseCtx({ turnNumber: simTurn(2) }))

    expect(prisma.location.update).toHaveBeenCalledWith({ where: { id: 'loc1' }, data: { isContested: false } })
    expect(result.changes[0]).toMatchObject({ entityType: 'FACTION', entityId: 'f1', field: 'territoryContested', newValue: 'secured', significant: true, importance: 'NORMAL' })
  })

  it('settles quietly, still clearing the contest, once the arc times out as a stalemate', async () => {
    vi.mocked(prisma.location.findMany).mockResolvedValueOnce([
      { id: 'loc1', name: 'Ore Hills', ownerFactionId: 'f1', loyaltyArc: { id: 'arc1', value: 5, startedTurn: 1 } },
    ] as any)
    vi.mocked(prisma.faction.findMany).mockResolvedValueOnce([
      { id: 'f1', name: 'Ashcrown', military: 50, ...factionTieRows('f1', { f2: { type: 'RIVAL', since: 1 } }) },
    ] as any)
    vi.mocked(prisma.faction.findUnique).mockResolvedValueOnce({ id: 'f2', name: 'Blackreach', military: 50, isActive: true } as any)

    const result = await tickTerritoryLoyalty(baseCtx({ turnNumber: simTurn(9) }))

    expect(prisma.location.update).toHaveBeenCalledWith({ where: { id: 'loc1' }, data: { isContested: false } })
    expect(result.changes[0]).toMatchObject({ field: 'territoryContested', newValue: 'settled', significant: false, importance: 'NORMAL' })
  })

  it('writes nothing in dry-run mode but still reports a resolving change', async () => {
    vi.mocked(prisma.location.findMany).mockResolvedValueOnce([
      { id: 'loc1', name: 'Ore Hills', ownerFactionId: 'f1', loyaltyArc: { id: 'arc1', value: -55, startedTurn: 1 } },
    ] as any)
    vi.mocked(prisma.faction.findMany).mockResolvedValueOnce([
      { id: 'f1', name: 'Ashcrown', military: 10, ...factionTieRows('f1', { f2: { type: 'RIVAL', since: 1 } }) },
    ] as any)
    vi.mocked(prisma.faction.findUnique).mockResolvedValueOnce({ id: 'f2', name: 'Blackreach', military: 90, isActive: true } as any)

    const result = await tickTerritoryLoyalty(baseCtx({ dryRun: true, turnNumber: simTurn(2) }))

    expect(prisma.arc.update).not.toHaveBeenCalled()
    expect(prisma.location.update).not.toHaveBeenCalled()
    expect(result.changes).toHaveLength(1)
  })

  it('handles multiple contested locations independently', async () => {
    vi.mocked(prisma.location.findMany).mockResolvedValueOnce([
      { id: 'loc1', name: 'Ore Hills', ownerFactionId: 'f1', loyaltyArc: null },
      { id: 'loc2', name: 'Timber Vale', ownerFactionId: 'f3', loyaltyArc: null },
    ] as any)
    vi.mocked(prisma.faction.findMany).mockResolvedValueOnce([
      { id: 'f1', name: 'Ashcrown', military: 50, ...factionTieRows('f1', { f2: { type: 'RIVAL', since: 1 } }) },
      { id: 'f3', name: 'Redgate', military: 50, ...factionTieRows('f3', {}) },
    ] as any)
    vi.mocked(prisma.faction.findUnique).mockResolvedValueOnce({ id: 'f2', name: 'Blackreach', military: 50, isActive: true } as any)
    vi.mocked(prisma.arc.create).mockResolvedValueOnce({ id: 'arc1', value: 0 } as any)

    const result = await tickTerritoryLoyalty(baseCtx())

    // loc2's owner has no rival, so only loc1 gets an arc at all.
    expect(prisma.arc.create).toHaveBeenCalledTimes(1)
    expect(result.changes).toEqual([])
  })

  it('#228: skips a location that is the contestedLocationId of a still-ESCALATING war', async () => {
    vi.mocked(prisma.location.findMany).mockResolvedValueOnce([
      { id: 'loc1', name: 'Ore Hills', ownerFactionId: 'f1', loyaltyArc: { id: 'arc1', value: -55, startedTurn: 1 } },
    ] as any)
    vi.mocked(prisma.war.findMany).mockResolvedValueOnce([{ contestedLocationId: 'loc1' }] as any)

    const result = await tickTerritoryLoyalty(baseCtx({ turnNumber: simTurn(2) }))

    // Never even reaches the faction lookups — the location is filtered
    // out before any owner/rival resolution happens.
    expect(prisma.faction.findMany).not.toHaveBeenCalled()
    expect(prisma.arc.update).not.toHaveBeenCalled()
    expect(prisma.location.update).not.toHaveBeenCalled()
    expect(result.changes).toEqual([])
  })

  it('#228: still processes a contested location once its war has resolved (RESOLVED wars do not exclude)', async () => {
    vi.mocked(prisma.location.findMany).mockResolvedValueOnce([
      { id: 'loc1', name: 'Ore Hills', ownerFactionId: 'f1', loyaltyArc: null },
    ] as any)
    vi.mocked(prisma.faction.findMany).mockResolvedValueOnce([
      { id: 'f1', name: 'Ashcrown', military: 50, ...factionTieRows('f1', { f2: { type: 'RIVAL', since: 1 } }) },
    ] as any)
    vi.mocked(prisma.faction.findUnique).mockResolvedValueOnce({ id: 'f2', name: 'Blackreach', military: 30, isActive: true } as any)
    // The war query itself only ever asks for status: 'ESCALATING', so a
    // RESOLVED war over this same location never comes back here at all —
    // asserting an empty result is what proves that filter is doing the
    // narrowing, not this test's mock.
    vi.mocked(prisma.war.findMany).mockResolvedValueOnce([])
    vi.mocked(prisma.arc.create).mockResolvedValueOnce({ id: 'arc1', value: 5 } as any)

    await tickTerritoryLoyalty(baseCtx({ turnNumber: simTurn(10) }))

    expect(prisma.war.findMany).toHaveBeenCalledWith({
      where: { campaignId: 'campaign-1', status: 'ESCALATING', contestedLocationId: { not: null } },
      select: { contestedLocationId: true },
    })
    expect(prisma.arc.create).toHaveBeenCalledTimes(1)
  })

  it('#228: excludes only the war-contested location, still processing an unrelated contested location the same pass', async () => {
    vi.mocked(prisma.location.findMany).mockResolvedValueOnce([
      { id: 'loc1', name: 'Ore Hills', ownerFactionId: 'f1', loyaltyArc: { id: 'arc1', value: -55, startedTurn: 1 } },
      { id: 'loc2', name: 'Timber Vale', ownerFactionId: 'f3', loyaltyArc: null },
    ] as any)
    vi.mocked(prisma.war.findMany).mockResolvedValueOnce([{ contestedLocationId: 'loc1' }] as any)
    vi.mocked(prisma.faction.findMany).mockResolvedValueOnce([
      { id: 'f3', name: 'Redgate', military: 50, ...factionTieRows('f3', { f4: { type: 'RIVAL', since: 1 } }) },
    ] as any)
    vi.mocked(prisma.faction.findUnique).mockResolvedValueOnce({ id: 'f4', name: 'Ninefold', military: 50, isActive: true } as any)
    vi.mocked(prisma.arc.create).mockResolvedValueOnce({ id: 'arc2', value: 0 } as any)

    await tickTerritoryLoyalty(baseCtx({ turnNumber: simTurn(10) }))

    // loc1 (at war) is filtered out before the faction fetch, so the
    // faction query only ever needs to resolve loc2's owner.
    expect(prisma.faction.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['f3'] }, isActive: true } }))
    expect(prisma.arc.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ locationId: 'loc2' }) }))
  })
})
