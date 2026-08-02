// src/lib/game/tick/__tests__/leadershipTick.test.ts
//
// Faction succession (#97) — the one simulation rule with no test.
//
// Every other tick module exports pure `decide*` functions that are
// covered in tick.test.ts. leadershipTick exported only its DB handler, so
// the whole rule was untestable and untested — while "succession" sat in
// the README's faction-simulation row as part of a 5.
//
// Extracting it surfaced two real defects, both pinned below: a hardcoded
// `previousValue: 'MEMBER'` recorded against a nullable column, and a
// tie-break left to Postgres row order in an engine that is deterministic
// everywhere else.

import { describe, it, expect } from 'vitest'
import { decideSuccession, type SuccessionCandidate } from '../leadershipTick'

const member = (over: Partial<SuccessionCandidate> = {}): SuccessionCandidate => ({
  id: 'npc1', name: 'Bram', importance: 2, factionRole: 'MEMBER', ...over,
})

const faction = (members: SuccessionCandidate[], leaderCharacterId: string | null = null, stability?: number) =>
  ({ name: 'The Ashcrown Court', leaderCharacterId, members, stability })

describe('decideSuccession', () => {
  it('promotes the most important living member when the seat is empty', () => {
    const decision = decideSuccession(faction([
      member({ id: 'a', name: 'Bram', importance: 2 }),
      member({ id: 'b', name: 'Sera', importance: 5 }),
      member({ id: 'c', name: 'Odo', importance: 1 }),
    ]))
    expect(decision).toMatchObject({ successorId: 'b', successorName: 'Sera' })
  })

  it('does nothing when a living leader is already in place', () => {
    // The idempotence that lets this run every tick as an invariant rather
    // than needing a death event to hook into.
    expect(decideSuccession(faction([
      member({ id: 'a', factionRole: 'LEADER' }),
      member({ id: 'b', importance: 9 }),
    ]))).toBeNull()
  })

  it('never promotes an NPC over a player-character leader', () => {
    // A player leading is not a gap to fill, however important the NPC.
    expect(decideSuccession(faction([member({ importance: 10 })], 'char1'))).toBeNull()
  })

  it('does nothing for a faction with no living members left', () => {
    expect(decideSuccession(faction([]))).toBeNull()
  })

  it('is deterministic when importance ties', () => {
    // The real bug this extraction fixed. The handler relied on the query's
    // `orderBy: { importance: 'desc' }`, which leaves equal-importance rows
    // in whatever order Postgres returns — so two equally ranked
    // lieutenants could promote differently on identical data. Ties now
    // break by name, then id.
    const tied = [
      member({ id: 'z', name: 'Yorick', importance: 4 }),
      member({ id: 'a', name: 'Alda', importance: 4 }),
    ]
    expect(decideSuccession(faction(tied))!.successorId).toBe('a')
    // Same set, opposite order in: same answer out.
    expect(decideSuccession(faction([...tied].reverse()))!.successorId).toBe('a')
  })

  it('falls back to id when name ties too, so the order is total', () => {
    const decision = decideSuccession(faction([
      member({ id: 'b2', name: 'Alda', importance: 4 }),
      member({ id: 'a1', name: 'Alda', importance: 4 }),
    ]))
    expect(decision!.successorId).toBe('a1')
  })

  it('records the role actually held, not a hardcoded MEMBER', () => {
    // factionRole is nullable. The handler used to stamp previousValue:
    // 'MEMBER' unconditionally, so an unranked member entered campaign
    // history having lost a role they never had.
    expect(decideSuccession(faction([member({ factionRole: null })]))!.previousRole).toBe('none')
    expect(decideSuccession(faction([member({ factionRole: 'MEMBER' })]))!.previousRole).toBe('MEMBER')
  })

  it('describes the promotion diegetically, naming both parties', () => {
    const decision = decideSuccession(faction([member({ name: 'Sera' })]))
    expect(decision!.reason).toContain('Sera')
    expect(decision!.reason).toContain('The Ashcrown Court')
  })

  it('does not mutate the members array it was handed', () => {
    // It sorts to pick a successor; sorting the caller's array in place
    // would quietly reorder the handler's own DB result.
    const members = [
      member({ id: 'a', name: 'Bram', importance: 1 }),
      member({ id: 'b', name: 'Sera', importance: 5 }),
    ]
    decideSuccession(faction(members))
    expect(members.map(m => m.id)).toEqual(['a', 'b'])
  })

  it('survives malformed importance rather than promoting on a NaN', () => {
    const decision = decideSuccession(faction([
      member({ id: 'a', name: 'Bram', importance: NaN as unknown as number }),
      member({ id: 'b', name: 'Sera', importance: 1 }),
    ]))
    expect(decision!.successorId).toBe('b')
  })

  it('tolerates a missing members array', () => {
    expect(decideSuccession({ name: 'X', leaderCharacterId: null, members: null as any })).toBeNull()
  })
})

describe('successionRoughness (#112)', () => {
  it('is low for a lone obvious heir in an otherwise-stable faction', () => {
    const decision = decideSuccession(faction([
      member({ id: 'a', name: 'Bram', importance: 9 }),
      member({ id: 'b', name: 'Odo', importance: 1 }),
    ], null, 90))
    expect(decision!.successionRoughness).toBeLessThan(0.3)
  })

  it('is higher when several members are near-tied with the successor', () => {
    const contested = decideSuccession(faction([
      member({ id: 'a', name: 'Bram', importance: 5 }),
      member({ id: 'b', name: 'Odo', importance: 5 }),
      member({ id: 'c', name: 'Sera', importance: 4 }),
    ], null, 90))!.successionRoughness

    const uncontested = decideSuccession(faction([
      member({ id: 'a', name: 'Bram', importance: 9 }),
      member({ id: 'b', name: 'Odo', importance: 1 }),
      member({ id: 'c', name: 'Sera', importance: 1 }),
    ], null, 90))!.successionRoughness

    expect(contested).toBeGreaterThan(uncontested)
  })

  it('is higher when the faction was already destabilized when its leader was lost', () => {
    const members = [
      member({ id: 'a', name: 'Bram', importance: 9 }),
      member({ id: 'b', name: 'Odo', importance: 1 }),
    ]
    const stable = decideSuccession(faction(members, null, 90))!.successionRoughness
    const destabilized = decideSuccession(faction(members, null, 10))!.successionRoughness
    expect(destabilized).toBeGreaterThan(stable)
  })

  it('falls back to a neutral stability estimate when stability is omitted, rather than NaN', () => {
    const decision = decideSuccession(faction([
      member({ id: 'a', name: 'Bram', importance: 9 }),
      member({ id: 'b', name: 'Odo', importance: 1 }),
    ]))
    expect(Number.isFinite(decision!.successionRoughness)).toBe(true)
    expect(decision!.successionRoughness).toBeGreaterThanOrEqual(0)
    expect(decision!.successionRoughness).toBeLessThanOrEqual(1)
  })

  it('stays within 0-1 at the extremes', () => {
    const decision = decideSuccession(faction([
      member({ id: 'a', name: 'Bram', importance: 5 }),
      member({ id: 'b', name: 'Odo', importance: 5 }),
    ], null, 0))
    expect(decision!.successionRoughness).toBeLessThanOrEqual(1)
    expect(decision!.successionRoughness).toBeGreaterThanOrEqual(0)
  })
})
