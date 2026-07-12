// src/lib/game/__tests__/capabilities.test.ts
// Knowledge-relative character sheets: band math, growth guardrails,
// origin seeding, and the single DB writer.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  proficiencyBand,
  computeUsageGain,
  applyArcGuardrail,
  decideSeedStates,
  slugifyCapabilityKey,
  summarizeCapabilities,
  applyCapabilityChanges,
  UNLOCK_STARTING_PROFICIENCY,
  ARC_LENGTH_TURNS,
  MAX_GROWTH_PER_ARC,
  NOVICE_MIN,
  COMPETENT_MIN,
  SKILLED_MIN,
  MASTERFUL_MIN,
} from '../capabilities'

describe('proficiencyBand', () => {
  it('maps thresholds to bands', () => {
    expect(proficiencyBand(0)).toBe('untrained')
    expect(proficiencyBand(NOVICE_MIN - 1)).toBe('untrained')
    expect(proficiencyBand(NOVICE_MIN)).toBe('novice')
    expect(proficiencyBand(COMPETENT_MIN)).toBe('competent')
    expect(proficiencyBand(SKILLED_MIN)).toBe('skilled')
    expect(proficiencyBand(MASTERFUL_MIN)).toBe('masterful')
    expect(proficiencyBand(100)).toBe('masterful')
  })
})

describe('computeUsageGain', () => {
  it('diminishes as proficiency rises', () => {
    const low = computeUsageGain(0, 'scene')
    const mid = computeUsageGain(50, 'scene')
    const high = computeUsageGain(90, 'scene')
    expect(low).toBeGreaterThan(mid)
    expect(mid).toBeGreaterThan(high)
    expect(high).toBeGreaterThanOrEqual(1)
  })

  it('training is the fast lane (2x scene)', () => {
    expect(computeUsageGain(40, 'training')).toBe(computeUsageGain(40, 'scene') * 2)
  })

  it('never overshoots 100', () => {
    expect(computeUsageGain(99, 'training')).toBe(1)
    expect(computeUsageGain(100, 'scene')).toBe(0)
  })
})

describe('applyArcGuardrail', () => {
  it('clamps gain to the remaining arc budget', () => {
    const result = applyArcGuardrail({ growthInArc: MAX_GROWTH_PER_ARC - 2, arcStartTurn: 5 }, 10, 6)
    expect(result.gain).toBe(2)
    expect(result.growthInArc).toBe(MAX_GROWTH_PER_ARC)
    expect(result.arcStartTurn).toBe(5)
  })

  it('grants nothing once the arc budget is spent', () => {
    const result = applyArcGuardrail({ growthInArc: MAX_GROWTH_PER_ARC, arcStartTurn: 5 }, 4, 9)
    expect(result.gain).toBe(0)
  })

  it('resets the window after ARC_LENGTH_TURNS', () => {
    const result = applyArcGuardrail(
      { growthInArc: MAX_GROWTH_PER_ARC, arcStartTurn: 0 },
      4,
      ARC_LENGTH_TURNS
    )
    expect(result.gain).toBe(4)
    expect(result.growthInArc).toBe(4)
    expect(result.arcStartTurn).toBe(ARC_LENGTH_TURNS)
  })
})

describe('decideSeedStates', () => {
  const scaffold = [
    { id: 'a', tier: 1, isSecret: false },
    { id: 'b', tier: 2, isSecret: false },
    { id: 'c', tier: 1, isSecret: true },
  ]

  it('NATIVE glimpses the whole non-secret tree', () => {
    const seeds = decideSeedStates('NATIVE', scaffold)
    expect(seeds.map(s => s.capabilityId).sort()).toEqual(['a', 'b'])
    expect(seeds.every(s => s.state === 'GLIMPSED')).toBe(true)
  })

  it('NEWCOMER only glimpses tier-1 non-secret nodes', () => {
    const seeds = decideSeedStates('NEWCOMER', scaffold)
    expect(seeds.map(s => s.capabilityId)).toEqual(['a'])
  })

  it('OUTSIDER starts with a blank sheet', () => {
    expect(decideSeedStates('OUTSIDER', scaffold)).toEqual([])
  })

  it('never seeds anything UNLOCKED', () => {
    const all = [
      ...decideSeedStates('NATIVE', scaffold),
      ...decideSeedStates('NEWCOMER', scaffold),
    ]
    expect(all.some(s => (s.state as string) === 'UNLOCKED')).toBe(false)
  })
})

describe('slugifyCapabilityKey', () => {
  it('normalizes names to stable keys', () => {
    expect(slugifyCapabilityKey('Dark Essence')).toBe('dark-essence')
    expect(slugifyCapabilityKey("  Ritual: Binder's Oath!  ")).toBe('ritual-binder-s-oath')
  })
})

describe('summarizeCapabilities', () => {
  it('splits known vs glimpsed and hides raw numbers', () => {
    const summary = summarizeCapabilities([
      {
        state: 'UNLOCKED',
        proficiency: 62,
        framedLabel: 'Kendo forms',
        hint: null,
        capability: { name: 'Swordplay', domain: 'Martial Arts', description: 'Blades.' },
      },
      {
        state: 'GLIMPSED',
        proficiency: 0,
        framedLabel: null,
        hint: 'Villagers drew power from stones',
        capability: { name: 'Essence Magic', domain: 'Essences', description: null },
      },
    ])
    expect(summary.known).toEqual([
      { name: 'Kendo forms', domain: 'Martial Arts', band: 'skilled', description: 'Blades.' },
    ])
    expect(summary.glimpsed).toEqual([{ domain: 'Essences', hint: 'Villagers drew power from stones' }])
    expect(summary.knownDomains).toEqual(['Essences', 'Martial Arts'])
    // The one representation that must never appear:
    expect(JSON.stringify(summary)).not.toContain('62')
  })
})

describe('applyCapabilityChanges (writer)', () => {
  const makeDb = () => ({
    campaignCapability: {
      findFirst: vi.fn(),
      create: vi.fn(async ({ data }: any) => ({ id: 'new-node', ...data })),
    },
    characterCapability: {
      findUnique: vi.fn(),
      create: vi.fn(async ({ data }: any) => data),
      upsert: vi.fn(async ({ create }: any) => create),
      update: vi.fn(async () => ({})),
    },
  })

  let db: ReturnType<typeof makeDb>
  beforeEach(() => {
    db = makeDb()
  })

  it('glimpse creates a GLIMPSED row once and is idempotent', async () => {
    db.campaignCapability.findFirst.mockResolvedValue({ id: 'cap1', name: 'Essence Magic' })
    db.characterCapability.findUnique.mockResolvedValueOnce(null)

    const log = await applyCapabilityChanges(db as any, 'camp1', 'char1', [
      { capability_key: 'essence-magic', change: 'glimpse', hint: 'saw a ritual', reason: 'watched' },
    ], 3)

    expect(db.characterCapability.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ state: 'GLIMPSED', hint: 'saw a ritual' }) })
    )
    expect(log).toEqual(['Glimpsed: Essence Magic'])

    // Second glimpse: row exists → no-op
    db.characterCapability.findUnique.mockResolvedValueOnce({ state: 'GLIMPSED' })
    const log2 = await applyCapabilityChanges(db as any, 'camp1', 'char1', [
      { capability_key: 'essence-magic', change: 'glimpse', reason: 'again' },
    ], 4)
    expect(log2).toEqual([])
    expect(db.characterCapability.create).toHaveBeenCalledTimes(1)
  })

  it('unlock upgrades a glimpse to UNLOCKED at novice proficiency', async () => {
    db.campaignCapability.findFirst.mockResolvedValue({ id: 'cap2', name: 'Dark Essence' })
    db.characterCapability.findUnique.mockResolvedValue({ state: 'GLIMPSED', framedLabel: null })

    const log = await applyCapabilityChanges(db as any, 'camp1', 'char1', [
      { capability_key: 'dark-essence', change: 'unlock', reason: 'absorbed it' },
    ], 5)

    expect(db.characterCapability.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ state: 'UNLOCKED', proficiency: UNLOCK_STARTING_PROFICIENCY }),
      })
    )
    expect(log).toEqual(['Unlocked: Dark Essence'])
  })

  it('progress applies a guarded gain and skips locked capabilities', async () => {
    db.campaignCapability.findFirst.mockResolvedValue({ id: 'cap3', name: 'Swordplay' })
    db.characterCapability.findUnique.mockResolvedValueOnce({
      id: 'row3', state: 'UNLOCKED', proficiency: 28, growthInArc: 0, arcStartTurn: 5,
    })

    // 28 → crosses the competent threshold with any positive gain
    const log = await applyCapabilityChanges(db as any, 'camp1', 'char1', [
      { capability_key: 'swordplay', change: 'progress', reason: 'duel' },
    ], 6)
    expect(db.characterCapability.update).toHaveBeenCalled()
    expect(log).toEqual(['Swordplay: now competent'])

    // Locked capability: progress must not apply
    db.characterCapability.findUnique.mockResolvedValueOnce({ state: 'GLIMPSED' })
    const log2 = await applyCapabilityChanges(db as any, 'camp1', 'char1', [
      { capability_key: 'swordplay', change: 'progress', reason: 'watched a duel' },
    ], 6)
    expect(log2).toEqual([])
    expect(db.characterCapability.update).toHaveBeenCalledTimes(1)
  })

  it('is_new creates a secret stub node; unknown keys without is_new are skipped', async () => {
    db.campaignCapability.findFirst.mockResolvedValue(null)
    db.characterCapability.findUnique.mockResolvedValue(null)

    const log = await applyCapabilityChanges(db as any, 'camp1', 'char1', [
      { capability_key: 'blood-runes', change: 'glimpse', is_new: true, name: 'Blood Runes', domain: 'Forbidden Arts', reason: 'saw the cultist' },
      { capability_key: 'not-real', change: 'progress', reason: 'nope' },
    ], 7)

    expect(db.campaignCapability.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ key: 'blood-runes', domain: 'Forbidden Arts', isSecret: true }),
      })
    )
    expect(log).toContain('New capability discovered in this world: Blood Runes')
    expect(log).toContain('Glimpsed: Blood Runes')
    // second change resolved no node and wasn't is_new → skipped silently
    expect(db.campaignCapability.create).toHaveBeenCalledTimes(1)
  })
})
