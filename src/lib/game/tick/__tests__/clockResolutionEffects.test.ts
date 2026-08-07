// src/lib/game/tick/__tests__/clockResolutionEffects.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ClockResolutionEffect } from '../clockResolutionEffects'

const mocks = vi.hoisted(() => ({
  campaignFindUnique: vi.fn(),
  locationFindMany: vi.fn(),
  locationFindUnique: vi.fn(),
  locationUpdate: vi.fn(),
  factionFindMany: vi.fn(),
  factionUpdate: vi.fn(),
  clockCreate: vi.fn(),
  generateClockResolutionEffects: vi.fn(),
  persistWorldEvents: vi.fn(),
  logSignificantChanges: vi.fn(),
  syncWikiEntriesForChanges: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: { findUnique: mocks.campaignFindUnique },
    location: { findMany: mocks.locationFindMany, findUnique: mocks.locationFindUnique, update: mocks.locationUpdate },
    faction: { findMany: mocks.factionFindMany, update: mocks.factionUpdate },
    clock: { create: mocks.clockCreate },
  },
}))
vi.mock('@/lib/ai/clockResolutionEffects', () => ({
  generateClockResolutionEffects: mocks.generateClockResolutionEffects,
}))
vi.mock('../worldEventLog', () => ({ persistWorldEvents: mocks.persistWorldEvents }))
vi.mock('../historyLog', () => ({ logSignificantChanges: mocks.logSignificantChanges }))
vi.mock('../wikiSync', () => ({ syncWikiEntriesForChanges: mocks.syncWikiEntriesForChanges }))

import { applyClockResolutionEffects, resolveGenericClockEffects } from '../clockResolutionEffects'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.campaignFindUnique.mockResolvedValue({ title: 'The Iron Vigil', universe: 'Grimdark Fantasy' })
  mocks.locationFindMany.mockResolvedValue([{ id: 'loc1', name: 'Greenstone' }])
  mocks.locationFindUnique.mockResolvedValue({ conditionScore: 60 })
  mocks.locationUpdate.mockResolvedValue({})
  mocks.factionFindMany.mockResolvedValue([{ id: 'fac1', name: 'Astral Survey Office', resources: 50, stability: 50, military: 50, threatLevel: 3 }])
  mocks.factionUpdate.mockResolvedValue({})
  mocks.clockCreate.mockResolvedValue({ id: 'newclock1', name: 'x' })
})

describe('applyClockResolutionEffects', () => {
  const sourceClock = { id: 'clock1', name: 'The Silver Landing', campaignId: 'camp1', agendaId: null }
  const locations = [
    { id: 'loc1', name: 'Greenstone' },
    { id: 'loc2', name: 'The Old Mill' },
  ]
  const factions = [
    { id: 'fac1', name: 'Astral Survey Office', resources: 50, stability: 60, military: 40, threatLevel: 3 },
  ]

  // This describe block calls applyClockResolutionEffects with its OWN
  // stub `db` object (not the mocked prisma singleton above) — it's a
  // pure function that takes its DB client as a parameter, so it doesn't
  // touch the module-level mocks at all.
  function makeDb() {
    return {
      clock: { create: vi.fn(async ({ data }: any) => ({ id: 'newclock1', name: data.name, ...data })) },
      location: {
        findUnique: vi.fn(async () => ({ conditionScore: 60 })),
        update: vi.fn(async () => ({})),
      },
      faction: { update: vi.fn(async () => ({})) },
    }
  }

  it('returns no changes for an empty effects list', async () => {
    const db = makeDb()
    const changes = await applyClockResolutionEffects(db as any, 1, sourceClock, [], locations, factions)
    expect(changes).toEqual([])
    expect(db.clock.create).not.toHaveBeenCalled()
  })

  describe('SPAWN_CLOCK', () => {
    it('creates a new clock chained via agendaId and emits a CLOCK WorldChange', async () => {
      const db = makeDb()
      const effects: ClockResolutionEffect[] = [
        { type: 'SPAWN_CLOCK', name: 'Astral Contamination Spreads', consequence: 'The breach widens.', category: 'urgent', maxTicks: 5, reason: 'unresolved threat' },
      ]
      const changes = await applyClockResolutionEffects(db as any, 1, sourceClock, effects, locations, factions)

      expect(db.clock.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          campaignId: 'camp1',
          name: 'Astral Contamination Spreads',
          consequence: 'The breach widens.',
          category: 'urgent',
          maxTicks: 5,
          currentTicks: 0,
          agendaId: 'clock1', // sourceClock.agendaId ?? sourceClock.id
        }),
      })
      expect(changes).toHaveLength(1)
      expect(changes[0]).toMatchObject({ entityType: 'CLOCK', field: 'spawned', origin: 'clockResolution' })
    })

    it('carries forward an existing agendaId rather than overwriting it with the source clock id', async () => {
      const db = makeDb()
      const chainedSource = { ...sourceClock, agendaId: 'root-clock-id' }
      const effects: ClockResolutionEffect[] = [{ type: 'SPAWN_CLOCK', name: 'Stage 3', consequence: 'x', reason: 'y' }]

      await applyClockResolutionEffects(db as any, 1, chainedSource, effects, locations, factions)

      expect(db.clock.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ agendaId: 'root-clock-id' }),
      })
    })

    it('clamps maxTicks into the 3-8 bound even if given an out-of-range value', async () => {
      const db = makeDb()
      const effects: ClockResolutionEffect[] = [{ type: 'SPAWN_CLOCK', name: 'x', consequence: 'y', maxTicks: 999, reason: 'z' }]
      await applyClockResolutionEffects(db as any, 1, sourceClock, effects, locations, factions)
      expect(db.clock.create).toHaveBeenCalledWith({ data: expect.objectContaining({ maxTicks: 8 }) })
    })

    it('skips an effect missing name or consequence rather than creating a broken clock', async () => {
      const db = makeDb()
      const effects: ClockResolutionEffect[] = [{ type: 'SPAWN_CLOCK', reason: 'z' } as ClockResolutionEffect]
      const changes = await applyClockResolutionEffects(db as any, 1, sourceClock, effects, locations, factions)
      expect(db.clock.create).not.toHaveBeenCalled()
      expect(changes).toEqual([])
    })
  })

  describe('LOCATION_EFFECT', () => {
    it('resolves a known location by exact name and updates conditionScore, clamped 0-100', async () => {
      const db = makeDb()
      const effects: ClockResolutionEffect[] = [
        { type: 'LOCATION_EFFECT', targetLocationName: 'Greenstone', conditionDelta: -10, reason: 'fallout' },
      ]
      const changes = await applyClockResolutionEffects(db as any, 1, sourceClock, effects, locations, factions)

      expect(db.location.update).toHaveBeenCalledWith({ where: { id: 'loc1' }, data: { conditionScore: 50 } })
      expect(changes).toHaveLength(1)
      expect(changes[0]).toMatchObject({
        entityType: 'LOCATION_CONDITION',
        entityId: 'loc1',
        entityName: 'Greenstone',
        previousValue: 60,
        newValue: 50,
        origin: 'clockResolution',
      })
    })

    it('skips an effect targeting a location that does not exist in this campaign', async () => {
      const db = makeDb()
      const effects: ClockResolutionEffect[] = [
        { type: 'LOCATION_EFFECT', targetLocationName: 'Nonexistent Ruins', conditionDelta: -10, reason: 'x' },
      ]
      const changes = await applyClockResolutionEffects(db as any, 1, sourceClock, effects, locations, factions)
      expect(db.location.update).not.toHaveBeenCalled()
      expect(changes).toEqual([])
    })

    it('clamps conditionDelta to ±15 even given a larger value', async () => {
      const db = makeDb()
      const effects: ClockResolutionEffect[] = [
        { type: 'LOCATION_EFFECT', targetLocationName: 'Greenstone', conditionDelta: -999, reason: 'x' },
      ]
      await applyClockResolutionEffects(db as any, 1, sourceClock, effects, locations, factions)
      // 60 - 15 = 45, not 60 - 999 clamped to 0 — the delta itself is bounded before applying.
      expect(db.location.update).toHaveBeenCalledWith({ where: { id: 'loc1' }, data: { conditionScore: 45 } })
    })

    it('clamps the resulting score at 0 when the location is already near the floor', async () => {
      const db = makeDb()
      db.location.findUnique = vi.fn(async () => ({ conditionScore: 5 }))
      const effects: ClockResolutionEffect[] = [
        { type: 'LOCATION_EFFECT', targetLocationName: 'Greenstone', conditionDelta: -15, reason: 'x' },
      ]
      await applyClockResolutionEffects(db as any, 1, sourceClock, effects, locations, factions)
      expect(db.location.update).toHaveBeenCalledWith({ where: { id: 'loc1' }, data: { conditionScore: 0 } })
    })
  })

  describe('FACTION_EFFECT', () => {
    it('resolves a known faction and applies clamped deltas to all four stats', async () => {
      const db = makeDb()
      const effects: ClockResolutionEffect[] = [
        {
          type: 'FACTION_EFFECT',
          targetFactionName: 'Astral Survey Office',
          resourceDelta: 5,
          stabilityDelta: -5,
          militaryDelta: 0,
          threatLevelDelta: 1,
          reason: 'directly involved',
        },
      ]
      const changes = await applyClockResolutionEffects(db as any, 1, sourceClock, effects, locations, factions)

      expect(db.faction.update).toHaveBeenCalledWith({
        where: { id: 'fac1' },
        data: { resources: 55, stability: 55, military: 40, threatLevel: 4 },
      })
      expect(changes).toHaveLength(1)
      expect(changes[0]).toMatchObject({ entityType: 'FACTION', entityId: 'fac1', origin: 'clockResolution' })
    })

    it('skips an effect targeting a faction that does not exist in this campaign', async () => {
      const db = makeDb()
      const effects: ClockResolutionEffect[] = [
        { type: 'FACTION_EFFECT', targetFactionName: 'The Nonexistent Cabal', resourceDelta: 5, reason: 'x' },
      ]
      const changes = await applyClockResolutionEffects(db as any, 1, sourceClock, effects, locations, factions)
      expect(db.faction.update).not.toHaveBeenCalled()
      expect(changes).toEqual([])
    })

    it('clamps resources/stability/military at the 0-100 floor and threatLevel at the 1-5 floor', async () => {
      const db = makeDb()
      const lowFaction = [{ id: 'fac1', name: 'Astral Survey Office', resources: 2, stability: 2, military: 2, threatLevel: 1 }]
      const effects: ClockResolutionEffect[] = [
        { type: 'FACTION_EFFECT', targetFactionName: 'Astral Survey Office', resourceDelta: -10, stabilityDelta: -10, militaryDelta: -10, threatLevelDelta: -1, reason: 'x' },
      ]
      await applyClockResolutionEffects(db as any, 1, sourceClock, effects, locations, lowFaction)
      expect(db.faction.update).toHaveBeenCalledWith({
        where: { id: 'fac1' },
        data: { resources: 0, stability: 0, military: 0, threatLevel: 1 },
      })
    })
  })

  it('caps at MAX_EFFECTS_PER_CLOCK even if more effects are passed in', async () => {
    const db = makeDb()
    const effects: ClockResolutionEffect[] = [
      { type: 'FACTION_EFFECT', targetFactionName: 'Astral Survey Office', resourceDelta: 1, reason: 'a' },
      { type: 'LOCATION_EFFECT', targetLocationName: 'Greenstone', conditionDelta: -1, reason: 'b' },
      { type: 'LOCATION_EFFECT', targetLocationName: 'The Old Mill', conditionDelta: -1, reason: 'c' },
    ]
    const changes = await applyClockResolutionEffects(db as any, 1, sourceClock, effects, locations, factions)
    expect(changes).toHaveLength(2)
  })
})

describe('resolveGenericClockEffects', () => {
  const clock = { id: 'clock1', name: 'The Silver Landing', description: null, consequence: 'Hazardous fallout spreads.', gmNotes: null, category: 'urgent', agendaId: null }

  it('returns immediately with no queries when there are no completed clocks', async () => {
    const result = await resolveGenericClockEffects('camp1', 1, [])
    expect(result).toEqual([])
    expect(mocks.campaignFindUnique).not.toHaveBeenCalled()
  })

  it('skips a clock the AI returns null or empty effects for, without touching the event pipeline', async () => {
    mocks.generateClockResolutionEffects.mockResolvedValue(null)
    const result = await resolveGenericClockEffects('camp1', 1, [clock])
    expect(result).toEqual([])
    expect(mocks.persistWorldEvents).not.toHaveBeenCalled()
  })

  it('applies effects and runs the full event pipeline on success', async () => {
    // applyClockResolutionEffects isn't mocked (it's the real pure function
    // in this same module) — it makes real calls against the mocked
    // prisma singleton, exercised end-to-end here.
    mocks.generateClockResolutionEffects.mockResolvedValue([
      { type: 'FACTION_EFFECT', targetFactionName: 'Astral Survey Office', resourceDelta: 5, reason: 'x' },
    ])

    const result = await resolveGenericClockEffects('camp1', 1, [clock])

    expect(mocks.factionUpdate).toHaveBeenCalledWith({
      where: { id: 'fac1' },
      data: { resources: 55, stability: 50, military: 50, threatLevel: 3 },
    })
    expect(mocks.persistWorldEvents).toHaveBeenCalledTimes(1)
    expect(mocks.logSignificantChanges).toHaveBeenCalledTimes(1)
    expect(mocks.syncWikiEntriesForChanges).toHaveBeenCalledTimes(1)
    expect(result.length).toBeGreaterThan(0)
  })

  it('never throws when a clock\'s AI call rejects, and still processes the remaining clocks', async () => {
    const clock2 = { ...clock, id: 'clock2', name: 'Purity Sweep' }
    mocks.generateClockResolutionEffects
      .mockRejectedValueOnce(new Error('API exploded'))
      .mockResolvedValueOnce([{ type: 'FACTION_EFFECT', targetFactionName: 'Astral Survey Office', resourceDelta: 5, reason: 'x' }])

    await expect(resolveGenericClockEffects('camp1', 1, [clock, clock2])).resolves.not.toThrow()
    expect(mocks.persistWorldEvents).toHaveBeenCalledTimes(1)
  })
})
