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
  shadowUnlockBlocked,
  prerequisiteUnlockBlocked,
  resolvePrerequisiteLinks,
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

  it('NEWCOMER skips tier-1 nodes that hang off a prerequisite (#82)', () => {
    // "Top-level" means a root of the tree, not merely a low tier — a
    // cheap art gated behind another art isn't something you've heard of
    // just by arriving.
    const tree = [
      { id: 'root', tier: 1, isSecret: false, parentId: null },
      { id: 'child', tier: 1, isSecret: false, parentId: 'root' },
    ]
    expect(decideSeedStates('NEWCOMER', tree).map(s => s.capabilityId)).toEqual(['root'])
  })

  it('NATIVE sees the whole tree regardless of depth', () => {
    const tree = [
      { id: 'root', tier: 1, isSecret: false, parentId: null },
      { id: 'deep', tier: 3, isSecret: false, parentId: 'root' },
    ]
    expect(decideSeedStates('NATIVE', tree).map(s => s.capabilityId).sort()).toEqual(['deep', 'root'])
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
      findUnique: vi.fn(async () => null),
      create: vi.fn(async ({ data }: any) => ({ id: 'new-node', ...data })),
    },
    characterCapability: {
      findUnique: vi.fn(),
      create: vi.fn(async ({ data }: any) => data),
      upsert: vi.fn(async ({ create }: any) => create),
      update: vi.fn(async () => ({})),
    },
    character: {
      findUnique: vi.fn(async () => ({ corruption: 0 })),
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

  it('shadow gate: an under-marked unlock downgrades to a glimpse', async () => {
    db.campaignCapability.findFirst.mockResolvedValue({
      id: 'cap4', name: 'Void Binding', tier: 2, isShadow: true,
    })
    db.characterCapability.findUnique.mockResolvedValue(null)
    db.character.findUnique.mockResolvedValue({ corruption: 1 } as any)

    const log = await applyCapabilityChanges(db as any, 'camp1', 'char1', [
      { capability_key: 'void-binding', change: 'unlock', reason: 'read the forbidden text' },
    ], 8)

    expect(db.characterCapability.upsert).not.toHaveBeenCalled()
    expect(db.characterCapability.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ state: 'GLIMPSED' }) })
    )
    expect(log[0]).toContain('Void Binding resists')
  })

  it('shadow gate: a sufficiently marked character unlocks normally', async () => {
    db.campaignCapability.findFirst.mockResolvedValue({
      id: 'cap4', name: 'Void Binding', tier: 2, isShadow: true,
    })
    db.characterCapability.findUnique.mockResolvedValue(null)
    db.character.findUnique.mockResolvedValue({ corruption: 2 } as any)

    const log = await applyCapabilityChanges(db as any, 'camp1', 'char1', [
      { capability_key: 'void-binding', change: 'unlock', reason: 'gave it what it wanted' },
    ], 8)

    expect(db.characterCapability.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ state: 'UNLOCKED' }) })
    )
    expect(log).toEqual(['Unlocked: Void Binding'])
  })

  it('prerequisite gate: unlocking a child of an un-unlocked parent downgrades to a glimpse', async () => {
    db.campaignCapability.findFirst.mockResolvedValue({
      id: 'cap5', name: 'Riposte', tier: 2, isShadow: false, parentId: 'cap-blade',
    })
    // The character's own row for Riposte, then the parent's row.
    db.characterCapability.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ state: 'GLIMPSED' })
    db.campaignCapability.findUnique.mockResolvedValue({ name: 'Bladework' } as any)

    const log = await applyCapabilityChanges(db as any, 'camp1', 'char1', [
      { capability_key: 'riposte', change: 'unlock', reason: 'improvised in a duel' },
    ], 9)

    expect(db.characterCapability.upsert).not.toHaveBeenCalled()
    expect(db.characterCapability.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ state: 'GLIMPSED' }) })
    )
    // The log line names the prerequisite: it goes into the resolution
    // summary, so the narrator learns the requirement instead of proposing
    // the same blocked unlock every scene.
    expect(log[0]).toContain('Bladework')
  })

  it('prerequisite gate: an unlocked parent lets the child through', async () => {
    db.campaignCapability.findFirst.mockResolvedValue({
      id: 'cap5', name: 'Riposte', tier: 2, isShadow: false, parentId: 'cap-blade',
    })
    db.characterCapability.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ state: 'UNLOCKED' })

    const log = await applyCapabilityChanges(db as any, 'camp1', 'char1', [
      { capability_key: 'riposte', change: 'unlock', reason: 'earned it' },
    ], 9)

    expect(db.characterCapability.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ state: 'UNLOCKED' }) })
    )
    expect(log).toEqual(['Unlocked: Riposte'])
  })

  it('prerequisite gate: a root node never triggers a parent lookup', async () => {
    db.campaignCapability.findFirst.mockResolvedValue({
      id: 'cap6', name: 'Bladework', tier: 1, isShadow: false, parentId: null,
    })
    db.characterCapability.findUnique.mockResolvedValue(null)

    const log = await applyCapabilityChanges(db as any, 'camp1', 'char1', [
      { capability_key: 'bladework', change: 'unlock', reason: 'trained' },
    ], 9)

    expect(db.campaignCapability.findUnique).not.toHaveBeenCalled()
    expect(log).toEqual(['Unlocked: Bladework'])
  })

  it('prerequisite gate: glimpsing a gated node is never blocked', async () => {
    // Same rule as the shadow gate — anyone may learn a deeper art exists.
    db.campaignCapability.findFirst.mockResolvedValue({
      id: 'cap5', name: 'Riposte', tier: 2, isShadow: false, parentId: 'cap-blade',
    })
    db.characterCapability.findUnique.mockResolvedValue(null)

    const log = await applyCapabilityChanges(db as any, 'camp1', 'char1', [
      { capability_key: 'riposte', change: 'glimpse', reason: 'saw it used' },
    ], 9)

    expect(db.campaignCapability.findUnique).not.toHaveBeenCalled()
    expect(log).toEqual(['Glimpsed: Riposte'])
  })

  it('shadow gate: glimpsing a shadow node is never gated', async () => {
    db.campaignCapability.findFirst.mockResolvedValue({
      id: 'cap4', name: 'Void Binding', tier: 3, isShadow: true,
    })
    db.characterCapability.findUnique.mockResolvedValue(null)

    const log = await applyCapabilityChanges(db as any, 'camp1', 'char1', [
      { capability_key: 'void-binding', change: 'glimpse', hint: 'a shape in the dark', reason: 'witnessed it' },
    ], 8)

    // No corruption lookup needed — the gate only guards unlocks.
    expect(db.character.findUnique).not.toHaveBeenCalled()
    expect(log).toEqual(['Glimpsed: Void Binding'])
  })
})

describe('shadowUnlockBlocked', () => {
  it('never gates non-shadow nodes', () => {
    expect(shadowUnlockBlocked({ isShadow: false, tier: 3 }, 0)).toBe(false)
  })

  it('requires marks at least equal to the tier', () => {
    expect(shadowUnlockBlocked({ isShadow: true, tier: 2 }, 1)).toBe(true)
    expect(shadowUnlockBlocked({ isShadow: true, tier: 2 }, 2)).toBe(false)
    expect(shadowUnlockBlocked({ isShadow: true, tier: 2 }, 5)).toBe(false)
  })

  it('floors the requirement at one mark even for tier-0 nodes', () => {
    expect(shadowUnlockBlocked({ isShadow: true, tier: 0 }, 0)).toBe(true)
    expect(shadowUnlockBlocked({ isShadow: true, tier: 0 }, 1)).toBe(false)
  })

  it('treats malformed corruption values as zero', () => {
    expect(shadowUnlockBlocked({ isShadow: true, tier: 1 }, NaN)).toBe(true)
    expect(shadowUnlockBlocked({ isShadow: true, tier: 1 }, undefined as any)).toBe(true)
  })
})

describe('prerequisiteUnlockBlocked (#82)', () => {
  it('never gates a root', () => {
    expect(prerequisiteUnlockBlocked({ parentId: null }, null)).toBe(false)
    expect(prerequisiteUnlockBlocked({}, null)).toBe(false)
  })

  it('blocks when the character has never met the prerequisite', () => {
    expect(prerequisiteUnlockBlocked({ parentId: 'p' }, null)).toBe(true)
  })

  it('blocks when the prerequisite is only glimpsed', () => {
    // Knowing the foundation EXISTS is not the same as being able to do it.
    expect(prerequisiteUnlockBlocked({ parentId: 'p' }, { state: 'GLIMPSED' })).toBe(true)
  })

  it('allows once the prerequisite is unlocked, at any proficiency', () => {
    // Deliberately not a proficiency threshold: a numeric bar would stall a
    // branch behind the per-arc growth cap for a number no player can see.
    expect(prerequisiteUnlockBlocked({ parentId: 'p' }, { state: 'UNLOCKED' })).toBe(false)
  })
})

describe('resolvePrerequisiteLinks (#82)', () => {
  const node = (key: string, domain: string, tier: number, requires?: string) => ({
    key, name: key, domain, tier, requires,
  })

  it('links a deeper art to the lower-tier art it names', () => {
    expect(resolvePrerequisiteLinks([
      node('bladework', 'Swordplay', 1),
      node('riposte', 'Swordplay', 2, 'bladework'),
    ])).toEqual([{ key: 'riposte', parentKey: 'bladework' }])
  })

  it('matches the prerequisite name case- and whitespace-insensitively', () => {
    const links = resolvePrerequisiteLinks([
      { key: 'cantrips', name: 'Cantrips', domain: 'Essence Magic', tier: 1 },
      { key: 'ritual', name: 'Ritual Casting', domain: 'Essence Magic', tier: 2, requires: '  cantrips ' },
    ])
    expect(links).toEqual([{ key: 'ritual', parentKey: 'cantrips' }])
  })

  it('drops a prerequisite that reaches into another domain', () => {
    // Cross-domain gating would make one branch silently un-unlockable
    // until an unrelated one was trained.
    expect(resolvePrerequisiteLinks([
      node('bladework', 'Swordplay', 1),
      node('ritual', 'Essence Magic', 2, 'bladework'),
    ])).toEqual([])
  })

  it('drops a prerequisite that is not strictly lower tier', () => {
    expect(resolvePrerequisiteLinks([
      node('a', 'D', 2),
      node('b', 'D', 2, 'a'),
    ])).toEqual([])
  })

  it('makes cycles structurally impossible', () => {
    // Every edge strictly decreases tier, so no chain can return to its
    // start — no cycle detection pass needed.
    const links = resolvePrerequisiteLinks([
      node('a', 'D', 1, 'b'),
      node('b', 'D', 2, 'a'),
    ])
    expect(links).toEqual([{ key: 'b', parentKey: 'a' }])
  })

  it('drops a prerequisite naming something that does not exist', () => {
    expect(resolvePrerequisiteLinks([node('b', 'D', 2, 'ghost')])).toEqual([])
  })

  it('leaves a scaffold with no declared prerequisites entirely rooted', () => {
    expect(resolvePrerequisiteLinks([
      node('a', 'D', 1),
      node('b', 'D', 2),
      node('c', 'D', 3),
    ])).toEqual([])
  })
})
