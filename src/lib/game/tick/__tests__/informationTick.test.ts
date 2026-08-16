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
    nPC: { findMany: vi.fn() },
    // #373: the social channel — word also travels through who an NPC
    // knows, not only through the map.
    npcTie: { findMany: vi.fn(async () => []) },
    eventWitness: { findMany: vi.fn(), createMany: vi.fn() },
    locationAdjacency: { findMany: vi.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import {
  decideInformationSpread,
  decideDistortion,
  tickInformation,
  computePropagationWindow,
  MIN_PROPAGATION_WINDOW_TURNS,
} from '../informationTick'
import type { TickContext } from '../types'

const db = prisma as any

function baseCtx(overrides: Partial<TickContext> = {}): TickContext {
  return { campaignId: 'campaign-1', turnNumber: 20, factionCap: 10, npcCap: 20, dryRun: false, db: prisma as any, ...overrides }
}

describe('decideInformationSpread — the social channel (#373)', () => {
  // Two islands with no road between them. Physically, 'far' can only ever
  // get the flat fallback delay (3). Socially, its NPC is one hop from
  // someone who was standing where it happened.
  const edges = [{ locationAId: 'a', locationBId: 'b', distance: 1 }]
  const event = { worldEventId: 'e1', turnNumber: 10, originLocationId: 'a' }
  const witness = { npcId: 'n-far', locationId: 'far' }
  const bystander = { npcId: 'n-there', locationId: 'a' }

  it('lets word reach an NPC through an ally faster than the map would', () => {
    // Physical: unreachable -> flat fallback 3. Social: 1 hop -> 1 + 1 = 2.
    const npcTies = [{ aId: 'n-far', bId: 'n-there', type: 'ALLY' as const, since: 1 }]

    expect(decideInformationSpread({
      currentTurn: 12, events: [event], characters: [], npcs: [bystander, witness],
      coveredPairs: new Set(), edges, npcTies,
    })).toContainEqual({ worldEventId: 'e1', npcId: 'n-far' })

    // Without the ties it is still waiting on the flat fallback at age 2.
    expect(decideInformationSpread({
      currentTurn: 12, events: [event], characters: [], npcs: [bystander, witness],
      coveredPairs: new Set(), edges,
    })).not.toContainEqual({ worldEventId: 'e1', npcId: 'n-far' })
  })

  it('does not carry word along a rivalry', () => {
    const npcTies = [{ aId: 'n-far', bId: 'n-there', type: 'RIVAL' as const, since: 1 }]

    expect(decideInformationSpread({
      currentTurn: 12, events: [event], characters: [], npcs: [bystander, witness],
      coveredPairs: new Set(), edges, npcTies,
    })).not.toContainEqual({ worldEventId: 'e1', npcId: 'n-far' })
  })

  it('never makes word arrive LATER than the map alone would', () => {
    // The social term is a minimum, so a campaign with ties can only ever
    // be faster. An NPC standing next door with no ties at all still hears
    // it on the same turn it always did.
    const nextDoor = { npcId: 'n-next', locationId: 'b' }
    const npcTies = [{ aId: 'n-far', bId: 'n-there', type: 'ALLY' as const, since: 1 }]

    const withTies = decideInformationSpread({
      currentTurn: 12, events: [event], characters: [], npcs: [bystander, nextDoor],
      coveredPairs: new Set(), edges, npcTies,
    })
    const withoutTies = decideInformationSpread({
      currentTurn: 12, events: [event], characters: [], npcs: [bystander, nextDoor],
      coveredPairs: new Set(), edges,
    })
    expect(withTies).toEqual(withoutTies)
  })

  it('gives no social channel when nobody was there to carry it', () => {
    // Seeds are the NPCs standing where it happened. With none, an ally
    // graph is a graph of people who also do not know.
    const npcTies = [{ aId: 'n-far', bId: 'n-other', type: 'ALLY' as const, since: 1 }]

    expect(decideInformationSpread({
      currentTurn: 12, events: [event], characters: [], npcs: [witness, { npcId: 'n-other', locationId: 'elsewhere' }],
      coveredPairs: new Set(), edges, npcTies,
    })).toEqual([])
  })

  it('leaves CHARACTER propagation on the map alone', () => {
    // Characters are players. They have no NpcTie rows and no social graph
    // of their own — giving them one would be a different feature, and
    // silently routing their knowledge through NPC alliances would change
    // what a player knows without any fiction behind it.
    const npcTies = [{ aId: 'n-far', bId: 'n-there', type: 'ALLY' as const, since: 1 }]
    const character = { characterId: 'n-far', locationId: 'far' }

    expect(decideInformationSpread({
      currentTurn: 12, events: [event], characters: [character], npcs: [bystander],
      coveredPairs: new Set(), edges, npcTies,
    })).not.toContainEqual({ worldEventId: 'e1', characterId: 'n-far' })
  })
})

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

  it('produces NPC decisions independently of character decisions for the same event', () => {
    const event = { worldEventId: 'e1', turnNumber: 10, originLocationId: 'a' }
    const character = { characterId: 'c1', locationId: 'unreachable' } // flat fallback 3, doesn't fire yet at age 2
    const npc = { npcId: 'n1', locationId: 'b' } // distance 1 -> delay 2, fires at age 2

    expect(decideInformationSpread({
      currentTurn: 12, events: [event], characters: [character], npcs: [npc], coveredPairs: new Set(), edges,
    })).toEqual([{ worldEventId: 'e1', npcId: 'n1' }])
  })

  it('never re-decides an NPC pair already covered, using the npc:-prefixed key', () => {
    const event = { worldEventId: 'e1', turnNumber: 10, originLocationId: 'a' }
    const npc = { npcId: 'n1', locationId: 'b' }

    expect(decideInformationSpread({
      currentTurn: 100, events: [event], characters: [], npcs: [npc], coveredPairs: new Set(['e1:npc:n1']), edges,
    })).toEqual([])
  })

  it('defaults npcs to an empty list when omitted (existing character-only callers unaffected)', () => {
    const event = { worldEventId: 'e1', turnNumber: 10, originLocationId: 'a' }
    const character = { characterId: 'c1', locationId: 'b' }

    expect(decideInformationSpread({
      currentTurn: 12, events: [event], characters: [character], coveredPairs: new Set(), edges,
    })).toEqual([{ worldEventId: 'e1', characterId: 'c1' }])
  })
})

describe('decideDistortion (#101 misinformation)', () => {
  it('is deterministic: same inputs always produce the same output', () => {
    const a = decideDistortion('e1', 'c1', 20, 5)
    const b = decideDistortion('e1', 'c1', 20, 5)
    expect(a).toEqual(b)
  })

  it('produces different distortion outcomes for a short vs. a long delay on the same event/witness/turn', () => {
    // Not a strict guarantee for every hash value, but with a fixed
    // worldEventId/witnessKey/turnNumber, only the delay-driven threshold
    // differs between these two calls — this pins the short-delay-vs-long-
    // delay threshold split is actually wired to the delay argument, not
    // ignored. A handful of representative ids below empirically cross the
    // boundary; if this ever flakes, it means the threshold logic itself
    // changed, which is exactly what this test exists to catch.
    let sawDifference = false
    for (let i = 0; i < 50; i++) {
      const key = `witness-${i}`
      const short = decideDistortion('e1', key, 20, 3)
      const long = decideDistortion('e1', key, 20, 10)
      if (short.distorted !== long.distorted) {
        sawDifference = true
        break
      }
    }
    expect(sawDifference).toBe(true)
  })

  it('never returns a flavor when not distorted, and always returns one of the 4 flavors when distorted', () => {
    const flavors = ['EXAGGERATED', 'MINIMIZED', 'GARBLED_DETAIL', 'ATTRIBUTED_WRONG']
    for (let i = 0; i < 30; i++) {
      const result = decideDistortion('e1', `witness-${i}`, 20, 10)
      if (result.distorted) {
        expect(flavors).toContain(result.flavor)
      } else {
        expect(result.flavor).toBeNull()
      }
    }
  })

  it('a Character and an NPC that share an underlying id do not always roll identically (witnessKey is actually used, not ignored)', () => {
    // decideInformationSpread always calls this with 'npc:<id>' for NPCs,
    // never the bare id — proves the prefix genuinely changes the hash
    // input rather than being dropped somewhere before it reaches stableHash.
    let sawDifference = false
    for (let i = 0; i < 50; i++) {
      const id = `shared-id-${i}`
      const character = decideDistortion('e1', id, 20, 10)
      const npc = decideDistortion('e1', `npc:${id}`, 20, 10)
      if (character.distorted !== npc.distorted || character.flavor !== npc.flavor) {
        sawDifference = true
        break
      }
    }
    expect(sawDifference).toBe(true)
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
    db.nPC.findMany.mockResolvedValue([])
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

  it('does nothing when there are no living characters AND no living NPCs', async () => {
    db.worldEvent.findMany.mockResolvedValue([
      { id: 'e1', turnNumber: 10, targetType: 'LOCATION', targetId: 'loc-1' },
    ])
    db.character.findMany.mockResolvedValue([])
    db.nPC.findMany.mockResolvedValue([])

    const result = await tickInformation(baseCtx())

    expect(result.changes).toEqual([])
    expect(db.eventWitness.createMany).not.toHaveBeenCalled()
  })

  it('still propagates to NPCs when there are zero living characters (regression: the old early-return checked characters.length alone)', async () => {
    db.worldEvent.findMany.mockResolvedValue([
      { id: 'e1', turnNumber: 10, targetType: 'LOCATION', targetId: 'loc-a' },
    ])
    db.character.findMany.mockResolvedValue([])
    db.nPC.findMany.mockResolvedValue([{ id: 'n1', locationId: 'loc-a' }])

    await tickInformation(baseCtx({ turnNumber: 13 }))

    expect(db.eventWitness.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ npcId: 'n1', grade: 'TOLD' })],
    }))
    expect(db.eventWitness.createMany.mock.calls[0][0].data[0]).not.toHaveProperty('characterId')
  })

  it('writes an NPC TOLD row with npcId set and no characterId', async () => {
    db.worldEvent.findMany.mockResolvedValue([
      { id: 'e1', turnNumber: 10, targetType: 'LOCATION', targetId: 'loc-a' },
    ])
    db.character.findMany.mockResolvedValue([])
    db.nPC.findMany.mockResolvedValue([{ id: 'n1', locationId: 'loc-a' }])

    await tickInformation(baseCtx({ turnNumber: 13 }))

    expect(db.eventWitness.createMany).toHaveBeenCalledTimes(1)
    const data = db.eventWitness.createMany.mock.calls[0][0].data
    expect(data).toHaveLength(1)
    expect(data[0].npcId).toBe('n1')
    expect(data[0].characterId).toBeUndefined()
    expect(data[0].grade).toBe('TOLD')
    expect(typeof data[0].distorted).toBe('boolean')
  })

  it('resolves an NPC-targeted event\'s origin from the WorldEvent.originLocationId column captured at write time', async () => {
    db.worldEvent.findMany.mockResolvedValue([
      { id: 'e1', turnNumber: 10, targetType: 'NPC', targetId: 'npc-1', originLocationId: 'loc-a' },
    ])
    db.character.findMany.mockResolvedValue([{ id: 'c1', locationId: 'loc-b' }])
    db.locationAdjacency.findMany.mockResolvedValue([{ locationAId: 'loc-a', locationBId: 'loc-b', distance: 1 }])

    await tickInformation(baseCtx({ turnNumber: 12 })) // age 2, delay 1+1=2 -> fires

    expect(db.eventWitness.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ campaignId: 'campaign-1', worldEventId: 'e1', characterId: 'c1', grade: 'TOLD', turnNumber: 12 })],
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
      data: [expect.objectContaining({ campaignId: 'campaign-1', worldEventId: 'e1', characterId: 'c1', grade: 'TOLD', turnNumber: 12 })],
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
      data: [expect.objectContaining({ campaignId: 'campaign-1', worldEventId: 'e1', characterId: 'c1', grade: 'TOLD', turnNumber: 13 })],
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
