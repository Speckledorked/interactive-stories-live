// src/lib/game/tick/__tests__/informationTick.test.ts
//
// #101 (PR 2/3): TOLD propagation — a character who wasn't present when a
// significant WorldEvent happened can still hear about it later, with a
// delay driven by real graph distance from where it happened to where
// they are now.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    worldEvent: { findMany: vi.fn() },
    character: { findMany: vi.fn() },
    eventWitness: { findMany: vi.fn(), createMany: vi.fn() },
    locationAdjacency: { findMany: vi.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import {
  decideInformationSpread,
  tickInformation,
  computePropagationWindow,
  MIN_PROPAGATION_WINDOW_TURNS,
} from '../informationTick'
import type { TickContext } from '../types'

const db = prisma as any

function baseCtx(overrides: Partial<TickContext> = {}): TickContext {
  return { campaignId: 'campaign-1', turnNumber: 20, factionCap: 10, npcCap: 20, dryRun: false, db: prisma as any, ...overrides }
}

describe('decideInformationSpread (#101)', () => {
  const edges = [{ locationAId: 'a', locationBId: 'b', distance: 1 }]

  it('fires once age has caught up with the graph-derived delay, not before', () => {
    const event = { worldEventId: 'e1', turnNumber: 10, originLocationId: 'a' }
    const character = { characterId: 'c1', locationId: 'b' }

    // distance 1 -> delay = 1 + 1 = 2. age 1 at turn 11: too early.
    expect(decideInformationSpread({
      currentTurn: 11, events: [event], characters: [character], coveredPairs: new Set(), edges,
    })).toEqual([])

    // age 2 at turn 12: fires.
    expect(decideInformationSpread({
      currentTurn: 12, events: [event], characters: [character], coveredPairs: new Set(), edges,
    })).toEqual([{ worldEventId: 'e1', characterId: 'c1' }])
  })

  it('uses the flat fallback delay when the graph does not connect the two locations', () => {
    const event = { worldEventId: 'e1', turnNumber: 10, originLocationId: 'a' }
    const character = { characterId: 'c1', locationId: 'unreachable' }

    expect(decideInformationSpread({
      currentTurn: 12, events: [event], characters: [character], coveredPairs: new Set(), edges,
    })).toEqual([]) // flat fallback is 3, age is only 2

    expect(decideInformationSpread({
      currentTurn: 13, events: [event], characters: [character], coveredPairs: new Set(), edges,
    })).toEqual([{ worldEventId: 'e1', characterId: 'c1' }])
  })

  it('uses the flat fallback delay when either location is unknown', () => {
    const event = { worldEventId: 'e1', turnNumber: 10, originLocationId: null }
    const character = { characterId: 'c1', locationId: 'b' }

    expect(decideInformationSpread({
      currentTurn: 13, events: [event], characters: [character], coveredPairs: new Set(), edges,
    })).toEqual([{ worldEventId: 'e1', characterId: 'c1' }])
  })

  it('never re-decides a pair that already has any EventWitness coverage', () => {
    const event = { worldEventId: 'e1', turnNumber: 10, originLocationId: 'a' }
    const character = { characterId: 'c1', locationId: 'b' }

    expect(decideInformationSpread({
      currentTurn: 100, events: [event], characters: [character], coveredPairs: new Set(['e1:c1']), edges,
    })).toEqual([])
  })

  it('decides independently per (event, character) pair, not just per event', () => {
    const events = [{ worldEventId: 'e1', turnNumber: 10, originLocationId: 'a' }]
    const characters = [
      { characterId: 'near', locationId: 'b' }, // distance 1 -> delay 2
      { characterId: 'far', locationId: 'unreachable' }, // flat fallback 3
    ]

    expect(decideInformationSpread({
      currentTurn: 12, events, characters, coveredPairs: new Set(), edges,
    })).toEqual([{ worldEventId: 'e1', characterId: 'near' }])

    expect(decideInformationSpread({
      currentTurn: 13, events, characters, coveredPairs: new Set(), edges,
    })).toEqual(expect.arrayContaining([
      { worldEventId: 'e1', characterId: 'near' },
      { worldEventId: 'e1', characterId: 'far' },
    ]))
  })
})

describe('computePropagationWindow (#101 v1.1)', () => {
  it('returns the floor + safety margin for an empty graph', () => {
    expect(computePropagationWindow([])).toBe(MIN_PROPAGATION_WINDOW_TURNS + 5)
  })

  it('grows with the graph diameter beyond the floor', () => {
    // A 12-hop line (13 locations): diameter 12 -> base 1+12=13, above the
    // floor of 10, so the window tracks the diameter instead of the floor.
    const edges = Array.from({ length: 12 }, (_, i) => ({
      locationAId: `loc-${i}`,
      locationBId: `loc-${i + 1}`,
      distance: 1,
    }))
    expect(computePropagationWindow(edges)).toBe(1 + 12 + 5)
  })

  it('falls back to a fixed generous window above the location-count cap, without computing a diameter', () => {
    // 51 locations (50 edges in a line) exceeds MAX_LOCATIONS_FOR_DIAMETER
    // (50) -- falls back rather than paying the O(V^2) diameter cost.
    const edges = Array.from({ length: 50 }, (_, i) => ({
      locationAId: `loc-${i}`,
      locationBId: `loc-${i + 1}`,
      distance: 1,
    }))
    expect(computePropagationWindow(edges)).toBe(60)
  })
})

describe('tickInformation (DB handler)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.eventWitness.findMany.mockResolvedValue([])
    db.locationAdjacency.findMany.mockResolvedValue([])
  })

  it('does nothing when there are no significant events in the propagation window', async () => {
    db.worldEvent.findMany.mockResolvedValue([])

    const result = await tickInformation(baseCtx())

    expect(result.changes).toEqual([])
    expect(db.character.findMany).not.toHaveBeenCalled()
    expect(db.eventWitness.createMany).not.toHaveBeenCalled()
  })

  it('bounds the WorldEvent query to a graph-diameter-derived propagation window, and to significant events', async () => {
    const edges = [{ locationAId: 'loc-a', locationBId: 'loc-b', distance: 1 }]
    db.locationAdjacency.findMany.mockResolvedValue(edges)
    db.worldEvent.findMany.mockResolvedValue([])

    await tickInformation(baseCtx({ turnNumber: 50 }))

    expect(db.worldEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        campaignId: 'campaign-1',
        significant: true,
        turnNumber: { gte: 50 - computePropagationWindow(edges) },
      }),
    }))
  })

  it('does nothing when there are no living characters', async () => {
    db.worldEvent.findMany.mockResolvedValue([
      { id: 'e1', turnNumber: 10, targetType: 'LOCATION', targetId: 'loc-1' },
    ])
    db.character.findMany.mockResolvedValue([])

    const result = await tickInformation(baseCtx())

    expect(result.changes).toEqual([])
    expect(db.eventWitness.createMany).not.toHaveBeenCalled()
  })

  it('resolves an NPC-targeted event\'s origin from the WorldEvent.originLocationId column captured at write time', async () => {
    db.worldEvent.findMany.mockResolvedValue([
      { id: 'e1', turnNumber: 10, targetType: 'NPC', targetId: 'npc-1', originLocationId: 'loc-a' },
    ])
    db.character.findMany.mockResolvedValue([{ id: 'c1', locationId: 'loc-b' }])
    db.locationAdjacency.findMany.mockResolvedValue([{ locationAId: 'loc-a', locationBId: 'loc-b', distance: 1 }])

    await tickInformation(baseCtx({ turnNumber: 12 })) // age 2, delay 1+1=2 -> fires

    expect(db.eventWitness.createMany).toHaveBeenCalledWith({
      data: [{ campaignId: 'campaign-1', worldEventId: 'e1', characterId: 'c1', grade: 'TOLD', turnNumber: 12 }],
      skipDuplicates: true,
    })
  })

  it('resolves a FACTION-targeted war-outcome event\'s origin from the WorldEvent.originLocationId column (the war\'s contested location, captured at write time)', async () => {
    db.worldEvent.findMany.mockResolvedValue([
      { id: 'e1', turnNumber: 10, targetType: 'FACTION', targetId: 'faction-1', originLocationId: 'loc-a' },
    ])
    db.character.findMany.mockResolvedValue([{ id: 'c1', locationId: 'loc-b' }])
    db.locationAdjacency.findMany.mockResolvedValue([{ locationAId: 'loc-a', locationBId: 'loc-b', distance: 1 }])

    await tickInformation(baseCtx({ turnNumber: 12 }))

    expect(db.eventWitness.createMany).toHaveBeenCalledWith({
      data: [{ campaignId: 'campaign-1', worldEventId: 'e1', characterId: 'c1', grade: 'TOLD', turnNumber: 12 }],
      skipDuplicates: true,
    })
  })

  it('treats a FACTION-targeted event with no originLocationId as having no location signal (flat fallback for everyone)', async () => {
    db.worldEvent.findMany.mockResolvedValue([
      { id: 'e1', turnNumber: 10, targetType: 'FACTION', targetId: 'faction-1', originLocationId: null },
    ])
    db.character.findMany.mockResolvedValue([{ id: 'c1', locationId: 'loc-b' }])

    // flat fallback delay is 3 -> age 2 at turn 12 doesn't fire yet
    await tickInformation(baseCtx({ turnNumber: 12 }))
    expect(db.eventWitness.createMany).not.toHaveBeenCalled()

    // age 3 at turn 13 fires
    await tickInformation(baseCtx({ turnNumber: 13 }))
    expect(db.eventWitness.createMany).toHaveBeenCalledWith({
      data: [{ campaignId: 'campaign-1', worldEventId: 'e1', characterId: 'c1', grade: 'TOLD', turnNumber: 13 }],
      skipDuplicates: true,
    })
  })

  it('excludes already-covered pairs from the write', async () => {
    db.worldEvent.findMany.mockResolvedValue([
      { id: 'e1', turnNumber: 10, targetType: 'LOCATION', targetId: 'loc-a' },
    ])
    db.character.findMany.mockResolvedValue([{ id: 'c1', locationId: 'loc-a' }])
    db.eventWitness.findMany.mockResolvedValue([{ worldEventId: 'e1', characterId: 'c1' }])

    await tickInformation(baseCtx({ turnNumber: 50 }))

    expect(db.eventWitness.createMany).not.toHaveBeenCalled()
  })

  it('passes skipDuplicates: true on every write', async () => {
    db.worldEvent.findMany.mockResolvedValue([
      { id: 'e1', turnNumber: 10, targetType: 'LOCATION', targetId: 'loc-a' },
    ])
    db.character.findMany.mockResolvedValue([{ id: 'c1', locationId: 'loc-a' }])

    await tickInformation(baseCtx({ turnNumber: 13 }))

    expect(db.eventWitness.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }))
  })

  it('writes nothing in dry-run mode but still computes changes: []', async () => {
    db.worldEvent.findMany.mockResolvedValue([
      { id: 'e1', turnNumber: 10, targetType: 'LOCATION', targetId: 'loc-a' },
    ])
    db.character.findMany.mockResolvedValue([{ id: 'c1', locationId: 'loc-a' }])

    const result = await tickInformation(baseCtx({ turnNumber: 13, dryRun: true }))

    expect(db.eventWitness.createMany).not.toHaveBeenCalled()
    expect(result.changes).toEqual([])
  })

  it('never emits a WorldChange — this handler only writes the silent EventWitness side-table', async () => {
    db.worldEvent.findMany.mockResolvedValue([
      { id: 'e1', turnNumber: 10, targetType: 'LOCATION', targetId: 'loc-a' },
    ])
    db.character.findMany.mockResolvedValue([{ id: 'c1', locationId: 'loc-a' }])

    const result = await tickInformation(baseCtx({ turnNumber: 13 }))

    expect(result).toEqual({ changes: [] })
  })
})
