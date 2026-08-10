import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    location: { findMany: vi.fn(), update: vi.fn() },
    nPC: { findMany: vi.fn(), update: vi.fn() },
    locationAdjacency: { findMany: vi.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import { decideMigration, tickMigration } from '../migrationTick'
import type { TickContext } from '../types'

function baseCtx(overrides: Partial<TickContext> = {}): TickContext {
  return { campaignId: 'campaign-1', turnNumber: 5, factionCap: 10, npcCap: 20, dryRun: false, db: prisma as any, ...overrides }
}

describe('decideMigration (#110)', () => {
  it('moves a resident NPC from a distressed location to the healthiest destination', () => {
    const { npcMoves } = decideMigration(
      [{ id: 'ruins', name: 'The Ruins', conditionScore: 10, population: null }],
      [
        { id: 'town', name: 'The Town', conditionScore: 60, population: null },
        { id: 'capital', name: 'The Capital', conditionScore: 90, population: null },
      ],
      [{ id: 'npc1', name: 'Aldric', locationId: 'ruins', isAlive: true }]
    )

    expect(npcMoves).toEqual([
      {
        npcId: 'npc1',
        npcName: 'Aldric',
        fromLocationId: 'ruins',
        fromLocationName: 'The Ruins',
        toLocationId: 'capital',
        toLocationName: 'The Capital',
      },
    ])
  })

  it('never moves a location\'s own residents into itself, even if it were its own top candidate', () => {
    const { npcMoves } = decideMigration(
      [{ id: 'ruins', name: 'The Ruins', conditionScore: 10, population: null }],
      [{ id: 'ruins', name: 'The Ruins', conditionScore: 10, population: null }],
      [{ id: 'npc1', name: 'Aldric', locationId: 'ruins', isAlive: true }]
    )
    expect(npcMoves).toEqual([])
  })

  it('ignores a location whose conditionScore is not actually below the distress threshold', () => {
    const { npcMoves, populationShifts } = decideMigration(
      [{ id: 'town', name: 'The Town', conditionScore: 40, population: 100 }],
      [{ id: 'capital', name: 'The Capital', conditionScore: 90, population: 500 }],
      [{ id: 'npc1', name: 'Aldric', locationId: 'town', isAlive: true }]
    )
    expect(npcMoves).toEqual([])
    expect(populationShifts).toEqual([])
  })

  it('ignores a dead NPC and one resident elsewhere', () => {
    const { npcMoves } = decideMigration(
      [{ id: 'ruins', name: 'The Ruins', conditionScore: 10, population: null }],
      [{ id: 'capital', name: 'The Capital', conditionScore: 90, population: null }],
      [
        { id: 'npc1', name: 'Dead Guy', locationId: 'ruins', isAlive: false },
        { id: 'npc2', name: 'Elsewhere Guy', locationId: 'somewhere-else', isAlive: true },
      ]
    )
    expect(npcMoves).toEqual([])
  })

  it('caps NPC moves per source location at the bounded maximum', () => {
    const residents = Array.from({ length: 6 }, (_, i) => ({
      id: `npc${i}`,
      name: `NPC ${i}`,
      locationId: 'ruins',
      isAlive: true,
    }))
    const { npcMoves } = decideMigration(
      [{ id: 'ruins', name: 'The Ruins', conditionScore: 5, population: null }],
      [{ id: 'capital', name: 'The Capital', conditionScore: 90, population: null }],
      residents
    )
    expect(npcMoves).toHaveLength(3)
  })

  it('picks the highest-condition destination when several are viable', () => {
    const { npcMoves } = decideMigration(
      [{ id: 'ruins', name: 'The Ruins', conditionScore: 5, population: null }],
      [
        { id: 'town', name: 'The Town', conditionScore: 55, population: null },
        { id: 'capital', name: 'The Capital', conditionScore: 95, population: null },
      ],
      [{ id: 'npc1', name: 'Aldric', locationId: 'ruins', isAlive: true }]
    )
    expect(npcMoves[0].toLocationId).toBe('capital')
  })

  it('shifts a tracked population from a distressed location to its destination', () => {
    const { populationShifts } = decideMigration(
      [{ id: 'ruins', name: 'The Ruins', conditionScore: 10, population: 1000 }],
      [{ id: 'capital', name: 'The Capital', conditionScore: 90, population: 500 }],
      []
    )
    expect(populationShifts).toEqual(
      expect.arrayContaining([
        { locationId: 'ruins', locationName: 'The Ruins', previousPopulation: 1000, newPopulation: 900 },
        { locationId: 'capital', locationName: 'The Capital', previousPopulation: 500, newPopulation: 600 },
      ])
    )
  })

  it('floors the fleeing population at 1 rather than rounding a small population to 0', () => {
    const { populationShifts } = decideMigration(
      [{ id: 'ruins', name: 'The Ruins', conditionScore: 10, population: 3 }],
      [{ id: 'capital', name: 'The Capital', conditionScore: 90, population: 500 }],
      []
    )
    const source = populationShifts.find((s) => s.locationId === 'ruins')!
    expect(source.newPopulation).toBe(2)
  })

  it('never leaves a source population negative', () => {
    const { populationShifts } = decideMigration(
      [{ id: 'ruins', name: 'The Ruins', conditionScore: 10, population: 0 }],
      [{ id: 'capital', name: 'The Capital', conditionScore: 90, population: 500 }],
      []
    )
    // population is already 0 — nothing left to flee, so no shift reported.
    expect(populationShifts.find((s) => s.locationId === 'ruins')).toBeUndefined()
  })

  it('does not report a population shift for a location that never tracked one', () => {
    const { populationShifts } = decideMigration(
      [{ id: 'ruins', name: 'The Ruins', conditionScore: 10, population: null }],
      [{ id: 'capital', name: 'The Capital', conditionScore: 90, population: null }],
      []
    )
    expect(populationShifts).toEqual([])
  })

  it('returns nothing when there are no viable destinations at all', () => {
    const result = decideMigration(
      [{ id: 'ruins', name: 'The Ruins', conditionScore: 10, population: 100 }],
      [],
      [{ id: 'npc1', name: 'Aldric', locationId: 'ruins', isAlive: true }]
    )
    expect(result).toEqual({ npcMoves: [], populationShifts: [] })
  })

  it('accumulates population inflow correctly when two distressed locations feed the same destination', () => {
    const { populationShifts } = decideMigration(
      [
        { id: 'ruins-a', name: 'Ruin A', conditionScore: 10, population: 100 },
        { id: 'ruins-b', name: 'Ruin B', conditionScore: 10, population: 200 },
      ],
      [{ id: 'capital', name: 'The Capital', conditionScore: 90, population: 1000 }],
      []
    )
    const dest = populationShifts.find((s) => s.locationId === 'capital')!
    // 10 from ruins-a (100 * 0.1) + 20 from ruins-b (200 * 0.1) = 30
    expect(dest.newPopulation).toBe(1030)
  })
})

describe('decideMigration — selfPreservation (NPC motivation model)', () => {
  it('orders fleeing residents by selfPreservation descending', () => {
    const { npcMoves } = decideMigration(
      [{ id: 'ruins', name: 'The Ruins', conditionScore: 5, population: null }],
      [{ id: 'capital', name: 'The Capital', conditionScore: 90, population: null }],
      [
        { id: 'cautious', name: 'Cautious', locationId: 'ruins', isAlive: true, selfPreservation: 90 },
        { id: 'ordinary', name: 'Ordinary', locationId: 'ruins', isAlive: true },
        { id: 'reckless', name: 'Reckless', locationId: 'ruins', isAlive: true, selfPreservation: 20 },
      ]
    )
    expect(npcMoves.map((m) => m.npcId)).toEqual(['cautious', 'ordinary', 'reckless'])
  })

  it('orders strictly by selfPreservation descending once the cap is actually binding', () => {
    const residents = [
      { id: 'a', name: 'A', locationId: 'ruins', isAlive: true, selfPreservation: 40 },
      { id: 'b', name: 'B', locationId: 'ruins', isAlive: true, selfPreservation: 95 },
      { id: 'c', name: 'C', locationId: 'ruins', isAlive: true, selfPreservation: 70 },
      { id: 'd', name: 'D', locationId: 'ruins', isAlive: true, selfPreservation: 60 },
    ]
    const { npcMoves } = decideMigration(
      [{ id: 'ruins', name: 'The Ruins', conditionScore: 5, population: null }],
      [{ id: 'capital', name: 'The Capital', conditionScore: 90, population: null }],
      residents
    )
    expect(npcMoves.map((m) => m.npcId)).toEqual(['b', 'c', 'd']) // top 3 by selfPreservation, 'a' left behind by the cap
  })

  it('never flees an NPC whose selfPreservation has drifted below the stay-behind threshold', () => {
    const { npcMoves } = decideMigration(
      [{ id: 'ruins', name: 'The Ruins', conditionScore: 5, population: null }],
      [{ id: 'capital', name: 'The Capital', conditionScore: 90, population: null }],
      [{ id: 'stubborn', name: 'Stubborn', locationId: 'ruins', isAlive: true, selfPreservation: 5 }]
    )
    expect(npcMoves).toEqual([])
  })

  it('falls back to neutral selfPreservation (50) when absent, unchanged from pre-model behavior', () => {
    const { npcMoves } = decideMigration(
      [{ id: 'ruins', name: 'The Ruins', conditionScore: 5, population: null }],
      [{ id: 'capital', name: 'The Capital', conditionScore: 90, population: null }],
      [{ id: 'npc1', name: 'Aldric', locationId: 'ruins', isAlive: true }]
    )
    expect(npcMoves).toHaveLength(1)
  })
})

describe('decideMigration — destination reachability (#108 follow-up)', () => {
  // #108's own audit finding: destination selection used to pick the
  // single highest-condition location campaign-wide, with no regard for
  // whether refugees could actually reach it — a location on the far,
  // disconnected side of the map could "win" over a genuinely nearby one.
  it('prefers a lower-condition but reachable destination over a higher-condition unreachable one', () => {
    const { npcMoves } = decideMigration(
      [{ id: 'ruins', name: 'The Ruins', conditionScore: 10, population: null }],
      [
        { id: 'far-capital', name: 'The Far Capital', conditionScore: 95, population: null },
        { id: 'near-town', name: 'The Near Town', conditionScore: 55, population: null },
      ],
      [{ id: 'npc1', name: 'Aldric', locationId: 'ruins', isAlive: true }],
      [{ locationAId: 'ruins', locationBId: 'near-town', distance: 1 }] // far-capital has no edge at all
    )
    expect(npcMoves[0].toLocationId).toBe('near-town')
  })

  it('picks the highest-condition destination among several reachable ones', () => {
    const { npcMoves } = decideMigration(
      [{ id: 'ruins', name: 'The Ruins', conditionScore: 10, population: null }],
      [
        { id: 'town', name: 'The Town', conditionScore: 55, population: null },
        { id: 'capital', name: 'The Capital', conditionScore: 90, population: null },
      ],
      [{ id: 'npc1', name: 'Aldric', locationId: 'ruins', isAlive: true }],
      [
        { locationAId: 'ruins', locationBId: 'town', distance: 1 },
        { locationAId: 'ruins', locationBId: 'capital', distance: 2 },
      ]
    )
    expect(npcMoves[0].toLocationId).toBe('capital')
  })

  it('falls back to the campaign-wide highest-condition pick when no edges cover this campaign at all', () => {
    const { npcMoves } = decideMigration(
      [{ id: 'ruins', name: 'The Ruins', conditionScore: 10, population: null }],
      [
        { id: 'town', name: 'The Town', conditionScore: 60, population: null },
        { id: 'capital', name: 'The Capital', conditionScore: 90, population: null },
      ],
      [{ id: 'npc1', name: 'Aldric', locationId: 'ruins', isAlive: true }],
      []
    )
    expect(npcMoves[0].toLocationId).toBe('capital')
  })

  it('falls back to the campaign-wide pick when the graph exists but doesn\'t reach any candidate from this location', () => {
    const { npcMoves } = decideMigration(
      [{ id: 'ruins', name: 'The Ruins', conditionScore: 10, population: null }],
      [{ id: 'capital', name: 'The Capital', conditionScore: 90, population: null }],
      [{ id: 'npc1', name: 'Aldric', locationId: 'ruins', isAlive: true }],
      // A real graph exists for this campaign, it just doesn't cover a
      // path from ruins to capital (disconnected component) — still
      // better to relocate refugees somewhere than strand them.
      [{ locationAId: 'some-other-a', locationBId: 'some-other-b', distance: 1 }]
    )
    expect(npcMoves[0].toLocationId).toBe('capital')
  })
})

describe('tickMigration (DB handler)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.locationAdjacency.findMany).mockResolvedValue([])
  })

  it('does nothing when no location is distressed', async () => {
    vi.mocked(prisma.location.findMany).mockResolvedValueOnce([
      { id: 'town', name: 'The Town', conditionScore: 60, population: null },
    ] as any)

    const result = await tickMigration(baseCtx())

    expect(result.changes).toEqual([])
    expect(prisma.nPC.findMany).not.toHaveBeenCalled()
  })

  it('does nothing when there is no viable destination even though a location is distressed', async () => {
    vi.mocked(prisma.location.findMany).mockResolvedValueOnce([
      { id: 'ruins', name: 'The Ruins', conditionScore: 10, population: null },
      { id: 'town', name: 'The Town', conditionScore: 40, population: null }, // below VIABLE_THRESHOLD
    ] as any)

    const result = await tickMigration(baseCtx())

    expect(result.changes).toEqual([])
    expect(prisma.nPC.findMany).not.toHaveBeenCalled()
  })

  it('moves a real NPC and reports a significant NPC change', async () => {
    vi.mocked(prisma.location.findMany).mockResolvedValueOnce([
      { id: 'ruins', name: 'The Ruins', conditionScore: 10, population: null },
      { id: 'capital', name: 'The Capital', conditionScore: 90, population: null },
    ] as any)
    vi.mocked(prisma.nPC.findMany).mockResolvedValueOnce([
      { id: 'npc1', name: 'Aldric', locationId: 'ruins', isAlive: true, importance: 3 },
    ] as any)

    const result = await tickMigration(baseCtx())

    expect(prisma.nPC.update).toHaveBeenCalledWith({
      where: { id: 'npc1' },
      data: { locationId: 'capital', currentLocation: 'The Capital' },
    })
    expect(result.changes).toHaveLength(1)
    expect(result.changes[0]).toMatchObject({
      entityType: 'NPC',
      field: 'currentLocation',
      significant: true,
      importance: 'NORMAL',
    })
  })

  it('marks a high-importance NPC\'s move as MAJOR', async () => {
    vi.mocked(prisma.location.findMany).mockResolvedValueOnce([
      { id: 'ruins', name: 'The Ruins', conditionScore: 10, population: null },
      { id: 'capital', name: 'The Capital', conditionScore: 90, population: null },
    ] as any)
    vi.mocked(prisma.nPC.findMany).mockResolvedValueOnce([
      { id: 'npc1', name: 'Aldric', locationId: 'ruins', isAlive: true, importance: 5 },
    ] as any)

    const result = await tickMigration(baseCtx())

    expect(result.changes[0]).toMatchObject({ importance: 'MAJOR' })
  })

  it('writes a population shift as a non-significant LOCATION_POPULATION change', async () => {
    vi.mocked(prisma.location.findMany).mockResolvedValueOnce([
      { id: 'ruins', name: 'The Ruins', conditionScore: 10, population: 100 },
      { id: 'capital', name: 'The Capital', conditionScore: 90, population: 500 },
    ] as any)
    vi.mocked(prisma.nPC.findMany).mockResolvedValueOnce([])

    const result = await tickMigration(baseCtx())

    expect(prisma.location.update).toHaveBeenCalledWith({
      where: { id: 'ruins' },
      data: { population: 90 },
    })
    expect(prisma.location.update).toHaveBeenCalledWith({
      where: { id: 'capital' },
      data: { population: 510 },
    })
    const shifts = result.changes.filter((c) => c.entityType === 'LOCATION_POPULATION')
    expect(shifts).toHaveLength(2)
    for (const shift of shifts) {
      expect(shift).toMatchObject({ significant: false, importance: 'NORMAL' })
    }
  })

  it('writes nothing in dry-run mode but still reports the changes', async () => {
    vi.mocked(prisma.location.findMany).mockResolvedValueOnce([
      { id: 'ruins', name: 'The Ruins', conditionScore: 10, population: 100 },
      { id: 'capital', name: 'The Capital', conditionScore: 90, population: 500 },
    ] as any)
    vi.mocked(prisma.nPC.findMany).mockResolvedValueOnce([
      { id: 'npc1', name: 'Aldric', locationId: 'ruins', isAlive: true, importance: 3 },
    ] as any)

    const result = await tickMigration(baseCtx({ dryRun: true }))

    expect(prisma.nPC.update).not.toHaveBeenCalled()
    expect(prisma.location.update).not.toHaveBeenCalled()
    expect(result.changes.length).toBeGreaterThan(0)
  })

  it('only queries NPCs at distressed locations, not the whole campaign roster', async () => {
    vi.mocked(prisma.location.findMany).mockResolvedValueOnce([
      { id: 'ruins', name: 'The Ruins', conditionScore: 10, population: null },
      { id: 'capital', name: 'The Capital', conditionScore: 90, population: null },
    ] as any)
    vi.mocked(prisma.nPC.findMany).mockResolvedValueOnce([])

    await tickMigration(baseCtx())

    expect(prisma.nPC.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          locationId: { in: ['ruins'] },
        }),
      })
    )
  })
})
