// src/lib/game/__tests__/standing.test.ts
// Faction standing: writer clamps/bounds, live-state effective modifier
// (the tick-reaches-the-dice rule), and diegetic shaping.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  applyStandingChanges,
  effectiveStandingModifier,
  standingLabel,
  summarizeStandings,
  STANDING_MAX,
} from '../standing'

describe('standingLabel', () => {
  it('maps the -3..+3 range to diegetic labels', () => {
    expect(standingLabel(-3)).toBe('hunted by')
    expect(standingLabel(0)).toBe('unknown to')
    expect(standingLabel(3)).toBe('honored by')
    expect(standingLabel(99)).toBe('honored by') // clamped
  })
})

describe('effectiveStandingModifier — live simulation state', () => {
  it('caps a healthy faction at ±2', () => {
    expect(effectiveStandingModifier(3, true, 70)).toBe(2)
    expect(effectiveStandingModifier(-3, true, 70)).toBe(-2)
    expect(effectiveStandingModifier(1, true, 70)).toBe(1)
  })

  it('caps a LOW-influence (war-weakened) faction at ±1', () => {
    expect(effectiveStandingModifier(3, true, 20)).toBe(1)
    expect(effectiveStandingModifier(-3, true, 20)).toBe(-1)
  })

  it('a collapsed faction is worth nothing', () => {
    expect(effectiveStandingModifier(3, false, 90)).toBe(0)
    expect(effectiveStandingModifier(-3, false, 90)).toBe(0)
  })
})

describe('applyStandingChanges (writer)', () => {
  const makeDb = () => ({
    faction: { findFirst: vi.fn() },
    factionStanding: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn(async () => ({})),
    },
  })
  let db: ReturnType<typeof makeDb>
  beforeEach(() => {
    db = makeDb()
  })

  it('creates a standing row clamped to ±1 per scene', async () => {
    db.faction.findFirst.mockResolvedValue({ id: 'f1', name: 'Thieves Guild' })

    const log = await applyStandingChanges(db as any, 'camp1', 'char1', 'Jason', [
      { faction_name: 'Thieves Guild', delta: 3, reason: 'Returned the ledger' },
    ])

    expect(db.factionStanding.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ value: 1 }) })
    )
    expect(log).toEqual(['Jason is now favored by Thieves Guild (Returned the ledger)'])
  })

  it('bounds accumulated standing at +3 and skips no-ops', async () => {
    db.faction.findFirst.mockResolvedValue({ id: 'f1', name: 'Thieves Guild' })
    db.factionStanding.findUnique.mockResolvedValue({ value: STANDING_MAX })

    const log = await applyStandingChanges(db as any, 'camp1', 'char1', 'Jason', [
      { faction_name: 'Thieves Guild', delta: 1, reason: 'More service' },
    ])
    expect(db.factionStanding.upsert).not.toHaveBeenCalled()
    expect(log).toEqual([])
  })

  it('skips unknown factions and zero deltas', async () => {
    db.faction.findFirst.mockResolvedValue(null)
    const log = await applyStandingChanges(db as any, 'camp1', 'char1', 'Jason', [
      { faction_name: 'Nonexistent Order', delta: 1, reason: 'x' },
      { faction_name: 'Thieves Guild', delta: 0, reason: 'x' },
    ])
    expect(db.factionStanding.upsert).not.toHaveBeenCalled()
    expect(log).toEqual([])
  })
})

describe('summarizeStandings', () => {
  it('filters neutral, inactive, and undiscovered factions', () => {
    const summary = summarizeStandings([
      { value: 2, faction: { name: 'Thieves Guild', isActive: true, isDiscovered: true } },
      { value: 0, faction: { name: 'Merchant League', isActive: true, isDiscovered: true } },
      { value: -3, faction: { name: 'Fallen Order', isActive: false, isDiscovered: true } },
      { value: 3, faction: { name: 'Secret Cabal', isActive: true, isDiscovered: false } },
      { value: -1, faction: { name: 'City Watch', isActive: true, isDiscovered: true } },
    ])
    expect(summary).toEqual([
      { faction: 'Thieves Guild', label: 'trusted by' },
      { faction: 'City Watch', label: 'distrusted by' },
    ])
  })
})
