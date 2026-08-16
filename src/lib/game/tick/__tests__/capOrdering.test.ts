// src/lib/game/tick/__tests__/capOrdering.test.ts
// #375: the per-tick roster — resolved once, applied by every handler,
// bumped once.
//
// The previous version of this file asserted
//   expect(TICK_ROTATION_ORDER).toEqual({ lastTickedAt: {...} })
// which restates the constant literal and therefore cannot fail for any
// reason a reader would care about. It passed while eleven handlers each
// selected a different slice of the roster inside one transaction. These
// tests assert the properties instead.

import { describe, it, expect, vi } from 'vitest'
import {
  TICK_ROTATION_ORDER,
  NPC_TICK_ROTATION_ORDER,
  resolveTickRoster,
  markRosterTicked,
  rosterFactionFilter,
  rosterNpcFilter,
  type TickRoster,
} from '../capOrdering'

function rosterDb(factions: Array<{ id: string }>, npcs: Array<{ id: string }>) {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    faction: { findMany: vi.fn(async (_args: any) => factions) },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    nPC: { findMany: vi.fn(async (_args: any) => npcs) },
  }
}

describe('resolveTickRoster', () => {
  it('selects the most-overdue entities, nulls first, with a deterministic id tiebreak', async () => {
    const db = rosterDb([{ id: 'f1' }, { id: 'f2' }], [{ id: 'n1' }])
    await resolveTickRoster(db, { campaignId: 'c1', factionCap: 10, npcCap: 20, npcImportanceThreshold: 4 })

    const factionArgs = db.faction.findMany.mock.calls[0][0] as any
    expect(factionArgs.orderBy).toEqual([
      { lastTickedAt: { sort: 'asc', nulls: 'first' } },
      { id: 'asc' },
    ])
    // The id tiebreak is load-bearing, not cosmetic: a whole roster bumped
    // by one updateMany shares a timestamp to the millisecond, so without
    // it Postgres is free to return a different slice each run and the
    // tick stops being deterministic.
    expect(factionArgs.orderBy[1]).toEqual({ id: 'asc' })

    const npcArgs = db.nPC.findMany.mock.calls[0][0] as any
    // Importance stays the PRIMARY key — rotation only breaks ties among
    // equally-important NPCs.
    expect(npcArgs.orderBy[0]).toEqual({ importance: 'desc' })
    expect(npcArgs.orderBy.slice(1)).toEqual(TICK_ROTATION_ORDER)
    expect(NPC_TICK_ROTATION_ORDER[0]).toEqual({ importance: 'desc' })
  })

  it('applies each cap to its own entity type', async () => {
    const db = rosterDb([], [])
    await resolveTickRoster(db, { campaignId: 'c1', factionCap: 7, npcCap: 3, npcImportanceThreshold: 4 })

    expect((db.faction.findMany.mock.calls[0][0] as any).take).toBe(7)
    expect((db.nPC.findMany.mock.calls[0][0] as any).take).toBe(3)
  })

  it('restricts to active factions and living, major NPCs', async () => {
    const db = rosterDb([], [])
    await resolveTickRoster(db, { campaignId: 'c1', factionCap: 10, npcCap: 20, npcImportanceThreshold: 4 })

    expect((db.faction.findMany.mock.calls[0][0] as any).where).toEqual({ campaignId: 'c1', isActive: true })
    expect((db.nPC.findMany.mock.calls[0][0] as any).where).toEqual({
      campaignId: 'c1',
      isAlive: true,
      importance: { gte: 4 },
    })
  })

  it('reports a cap hit when the roster came back full', async () => {
    const db = rosterDb([{ id: 'f1' }, { id: 'f2' }], [{ id: 'n1' }])
    const roster = await resolveTickRoster(db, { campaignId: 'c1', factionCap: 2, npcCap: 20, npcImportanceThreshold: 4 })

    // Consumers that advance a "processed through turn N" watermark need
    // this: marking a turn fully processed after looking at only a capped
    // subset is exactly how drift used to be lost permanently.
    expect(roster.factionCapHit).toBe(true)
    expect(roster.npcCapHit).toBe(false)
  })

  it('reports no cap hit when the roster fits', async () => {
    const db = rosterDb([{ id: 'f1' }], [{ id: 'n1' }])
    const roster = await resolveTickRoster(db, { campaignId: 'c1', factionCap: 10, npcCap: 20, npcImportanceThreshold: 4 })

    expect(roster.factionCapHit).toBe(false)
    expect(roster.npcCapHit).toBe(false)
  })
})

describe('roster filters', () => {
  const roster: TickRoster = {
    factionIds: ['f1', 'f2'],
    npcIds: ['n1'],
    factionCapHit: false,
    npcCapHit: false,
  }

  it('pins a handler to exactly the ids the tick resolved', () => {
    expect(rosterFactionFilter({ roster })).toEqual({ id: { in: ['f1', 'f2'] } })
    expect(rosterNpcFilter({ roster })).toEqual({ id: { in: ['n1'] } })
  })

  it('adds no predicate when no roster is present', () => {
    // Single-handler unit tests construct a bare TickContext. The absence
    // of a roster must NOT fall back to a per-handler capped query — that
    // is the defect this module replaced.
    expect(rosterFactionFilter({})).toEqual({})
    expect(rosterNpcFilter({})).toEqual({})
  })
})

describe('markRosterTicked', () => {
  it('stamps every selected entity with ONE timestamp captured by the caller', async () => {
    const factionUpdateMany = vi.fn(async () => ({ count: 2 }))
    const npcUpdateMany = vi.fn(async () => ({ count: 1 }))
    const at = new Date('2026-08-16T09:00:00.000Z')

    await markRosterTicked(
      { faction: { updateMany: factionUpdateMany }, nPC: { updateMany: npcUpdateMany } } as any,
      { factionIds: ['f1', 'f2'], npcIds: ['n1'], factionCapHit: false, npcCapHit: false },
      at
    )

    // One timestamp, supplied by the caller — not read from the clock in
    // here. A tick that reads the wall clock to decide anything is a tick
    // that cannot be replayed or previewed.
    expect(factionUpdateMany).toHaveBeenCalledWith({ where: { id: { in: ['f1', 'f2'] } }, data: { lastTickedAt: at } })
    expect(npcUpdateMany).toHaveBeenCalledWith({ where: { id: { in: ['n1'] } }, data: { lastTickedAt: at } })
  })

  it('does not query at all for an empty selection', async () => {
    const factionUpdateMany = vi.fn(async () => ({ count: 0 }))
    const npcUpdateMany = vi.fn(async () => ({ count: 0 }))

    await markRosterTicked(
      { faction: { updateMany: factionUpdateMany }, nPC: { updateMany: npcUpdateMany } } as any,
      { factionIds: [], npcIds: [], factionCapHit: false, npcCapHit: false },
      new Date()
    )

    expect(factionUpdateMany).not.toHaveBeenCalled()
    expect(npcUpdateMany).not.toHaveBeenCalled()
  })
})
