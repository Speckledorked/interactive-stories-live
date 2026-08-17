// src/lib/game/tick/__tests__/npcSocietyTies.test.ts
// #373: the DB half of Phase 9's NPC society, now that ties are edge rows.
// The pure decisions live in npcSocietyTick.test.ts; this covers what the
// handler actually writes, which is the part the storage change moved.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const db = vi.hoisted(() => ({
  nPC: { findMany: vi.fn(async (): Promise<any[]> => []) },
  location: { findMany: vi.fn(async (): Promise<any[]> => []) },
  faction: { findMany: vi.fn(async (): Promise<any[]> => []) },
  factionTie: { findMany: vi.fn(async (): Promise<any[]> => []) },
  npcTie: {
    findMany: vi.fn(async (): Promise<any[]> => []),
    upsert: vi.fn(async () => ({})),
    deleteMany: vi.fn(async () => ({ count: 0 })),
  },
  clock: { findMany: vi.fn(async (): Promise<any[]> => []), create: vi.fn(async () => ({})) },
}))

import { tickNpcSocialTies, tickNpcJointSchemes } from '../npcSocietyTick'
import { npcTieTable, factionTieTable } from './tieFixtures'
import type { TickContext } from '../types'
import { simTurn } from '@/lib/game/turnClock'

function baseCtx(overrides: Partial<TickContext> = {}): TickContext {
  return { campaignId: 'camp1', turnNumber: simTurn(12), factionCap: 10, npcCap: 20, dryRun: false, db: db as any, ...overrides }
}

const npc = (id: string, overrides: Record<string, any> = {}) => ({
  id, name: id, factionId: null, threat: null, currentLocation: null, ...overrides,
})

/** Every pair the handler upserted, as `a:b:TYPE`. */
function upsertedPairs() {
  return (db.npcTie.upsert.mock.calls as unknown as any[][])
    .map((call) => {
      const args = call[0] as any
      const { npcAId, npcBId } = args.where.npcAId_npcBId
      return `${npcAId}:${npcBId}:${args.create.type}`
    })
    .sort()
}

beforeEach(() => {
  vi.clearAllMocks()
  db.location.findMany.mockResolvedValue([])
  db.faction.findMany.mockResolvedValue([])
  db.factionTie.findMany.mockResolvedValue([])
  db.npcTie.findMany.mockResolvedValue([])
  db.clock.findMany.mockResolvedValue([])
})

describe('tickNpcSocialTies — edge writes (#373)', () => {
  it('writes one canonically-ordered row per pair, not one per side', () => {
    // Two colleagues in one faction. The old writer set an entry on BOTH
    // NPCs; there is one row now, and which id lands in npcAId is decided
    // by ordering rather than by which NPC the loop happened to reach.
    db.nPC.findMany.mockResolvedValue([npc('zeta', { factionId: 'f1' }), npc('alpha', { factionId: 'f1' })])

    return tickNpcSocialTies(baseCtx()).then(() => {
      expect(upsertedPairs()).toEqual(['alpha:zeta:ALLY'])
      expect(db.npcTie.upsert).toHaveBeenCalledTimes(1)
    })
  })

  it('stamps the tie with the turn it formed', async () => {
    db.nPC.findMany.mockResolvedValue([npc('a', { factionId: 'f1' }), npc('b', { factionId: 'f1' })])

    await tickNpcSocialTies(baseCtx({ turnNumber: simTurn(41) }))

    expect(db.npcTie.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ since: 41, campaignId: 'camp1' }) })
    )
  })

  it('inherits a rivalry from the two NPCs\' factions', async () => {
    db.nPC.findMany.mockResolvedValue([npc('a', { factionId: 'f1' }), npc('b', { factionId: 'f2' })])
    db.factionTie.findMany.mockResolvedValue(factionTieTable([['f1', 'f2', 'RIVAL', 2]]) as any)

    await tickNpcSocialTies(baseCtx())

    expect(upsertedPairs()).toEqual(['a:b:RIVAL'])
  })

  it('leaves an unchanged tie alone rather than rewriting it every turn', async () => {
    db.nPC.findMany.mockResolvedValue([npc('a', { factionId: 'f1' }), npc('b', { factionId: 'f1' })])
    db.npcTie.findMany.mockResolvedValue(npcTieTable([['a', 'b', 'ALLY', 3]]) as any)

    await tickNpcSocialTies(baseCtx())

    expect(db.npcTie.upsert).not.toHaveBeenCalled()
    expect(db.npcTie.deleteMany).not.toHaveBeenCalled()
  })

  it('deletes the row when the tie lapses to NEUTRAL', async () => {
    // NEUTRAL is the ABSENCE of a row, not a third stored value — so "no
    // tie" has exactly one representation.
    db.nPC.findMany.mockResolvedValue([npc('a', { factionId: 'f1' }), npc('b', { factionId: 'f2' })])
    db.npcTie.findMany.mockResolvedValue(npcTieTable([['a', 'b', 'ALLY', 3]]) as any)
    db.factionTie.findMany.mockResolvedValue([]) // the factions are no longer allied

    const result = await tickNpcSocialTies(baseCtx())

    expect(db.npcTie.deleteMany).toHaveBeenCalledWith({ where: { npcAId: 'a', npcBId: 'b' } })
    expect(result.changes.some((c) => c.newValue === 'NEUTRAL')).toBe(true)
  })

  it('expires a tie whose other side has left the roster, and does it once', async () => {
    // Nothing else ever visits these, so without the expiry pass a tie to a
    // dead NPC stays on record forever. Reported once per pair, not once
    // per direction.
    db.nPC.findMany.mockResolvedValue([npc('a', { factionId: 'f1' })])
    db.npcTie.findMany.mockResolvedValue(npcTieTable([['a', 'ghost', 'RIVAL', 3]]) as any)

    const result = await tickNpcSocialTies(baseCtx())

    expect(db.npcTie.deleteMany).toHaveBeenCalledTimes(1)
    expect(db.npcTie.deleteMany).toHaveBeenCalledWith({ where: { npcAId: 'a', npcBId: 'ghost' } })
    expect(result.changes.filter((c) => c.newValue === 'NEUTRAL')).toHaveLength(1)
  })

  it('keeps a tie to a live major NPC who is merely outside this rotation', async () => {
    // The bug: validity was checked against this tick's CAPPED, ROTATING
    // slice, so "not in this rotation" read as "no longer exists". Above
    // npcCap major NPCs that deleted and recreated ties every world turn —
    // resetting `since`, destroying findRivalIds' longest-standing-rivalry
    // ordering, and emitting untrue "the rivalry lapses" changes. Which
    // ties survived depended on which slice the cap selected, which is
    // exactly what the roster must never leak into world state.
    db.nPC.findMany
      .mockResolvedValueOnce([npc('a', { factionId: 'f1' })])           // this tick's slice
      .mockResolvedValueOnce([{ id: 'a' }, { id: 'rotated-out' }])      // everyone eligible
    db.npcTie.findMany.mockResolvedValue(npcTieTable([['a', 'rotated-out', 'ALLY', 3]]) as any)

    const result = await tickNpcSocialTies(baseCtx())

    expect(db.npcTie.deleteMany).not.toHaveBeenCalled()
    expect(result.changes).toEqual([])
  })

  it('still expires a tie to an NPC who is genuinely gone', async () => {
    db.nPC.findMany
      .mockResolvedValueOnce([npc('a', { factionId: 'f1' })])
      .mockResolvedValueOnce([{ id: 'a' }]) // 'ghost' is not eligible anywhere
    db.npcTie.findMany.mockResolvedValue(npcTieTable([['a', 'ghost', 'RIVAL', 3]]) as any)

    await tickNpcSocialTies(baseCtx())

    expect(db.npcTie.deleteMany).toHaveBeenCalledWith({ where: { npcAId: 'a', npcBId: 'ghost' } })
  })

  it('leaves a tie between two NPCs both outside the roster untouched', async () => {
    // This tick has no opinion about a pair it is not simulating — expiring
    // it would make what survives depend on which slice the cap selected.
    db.nPC.findMany.mockResolvedValue([npc('a', { factionId: 'f1' })])
    db.npcTie.findMany.mockResolvedValue(npcTieTable([['x', 'y', 'ALLY', 3]]) as any)

    await tickNpcSocialTies(baseCtx())

    expect(db.npcTie.deleteMany).not.toHaveBeenCalled()
  })

  it('writes nothing on a dry run but still reports the changes', async () => {
    db.nPC.findMany.mockResolvedValue([npc('a', { factionId: 'f1' }), npc('b', { factionId: 'f1' })])

    const result = await tickNpcSocialTies(baseCtx({ dryRun: true }))

    expect(db.npcTie.upsert).not.toHaveBeenCalled()
    expect(db.npcTie.deleteMany).not.toHaveBeenCalled()
    expect(result.changes.length).toBeGreaterThan(0)
  })
})

describe('tickNpcJointSchemes — reading ally pairs as edges (#373)', () => {
  it('reads each ALLY pair exactly once, without de-duplicating two copies', async () => {
    // Under the blobs this walked every NPC's map and skipped the second
    // copy of each pair with a `seen` set. An edge IS the pair.
    db.nPC.findMany.mockResolvedValue([
      { id: 'a', name: 'A', goals: null },
      { id: 'b', name: 'B', goals: null },
    ])
    db.npcTie.findMany.mockResolvedValue([{ npcAId: 'a', npcBId: 'b' }] as any)

    await tickNpcJointSchemes(baseCtx())

    expect(db.npcTie.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ type: 'ALLY' }) })
    )
  })

  it('ignores an ally pair whose other half is outside this tick\'s roster', async () => {
    db.nPC.findMany.mockResolvedValue([{ id: 'a', name: 'A', goals: null }])
    db.npcTie.findMany.mockResolvedValue([{ npcAId: 'a', npcBId: 'offscreen' }] as any)

    const result = await tickNpcJointSchemes(baseCtx())

    expect(db.clock.create).not.toHaveBeenCalled()
    expect(result.changes).toEqual([])
  })
})
