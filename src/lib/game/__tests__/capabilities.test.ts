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
import { uniqueConstraintError } from '../worldUpdaters/__tests__/testPrismaErrors'

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
      { id: 'root', tier: 1, isSecret: false, prerequisiteCount: 0 },
      { id: 'child', tier: 1, isSecret: false, prerequisiteCount: 1 },
    ]
    expect(decideSeedStates('NEWCOMER', tree).map(s => s.capabilityId)).toEqual(['root'])
  })

  it('NATIVE sees the whole tree regardless of depth', () => {
    const tree = [
      { id: 'root', tier: 1, isSecret: false, prerequisiteCount: 0 },
      { id: 'deep', tier: 3, isSecret: false, prerequisiteCount: 1 },
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
      // #386: an AI-minted node inherits its position and shadow-ness
      // from the domain it claims to belong to, instead of being born
      // parentless and non-shadow — i.e. born exempt from both gates.
      findMany: vi.fn(async () => [] as any[]),
      create: vi.fn(async ({ data }: any) => ({ id: 'new-node', ...data })),
    },
    characterCapability: {
      findUnique: vi.fn(),
      // #372: the prerequisite gate reads every prerequisite's state in one
      // query rather than one per edge, so the writer's cost is the same
      // for a node with three prerequisites as for a node with one.
      findMany: vi.fn(async () => [] as any[]),
      count: vi.fn(async () => 0),
      create: vi.fn(async ({ data }: any) => data),
      upsert: vi.fn(async ({ create }: any) => create),
      update: vi.fn(async () => ({})),
    },
    // #372: prerequisites live in their own edge table now — a node can
    // require more than one thing, so there is no single parentId column
    // to read off the node itself.
    capabilityPrerequisite: {
      findMany: vi.fn(async () => [] as Array<{ prerequisiteCapabilityId: string }>),
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
        data: expect.objectContaining({ key: 'blood-runes', domain: 'Forbidden Arts', isSecret: true, isNarrated: true }),
      })
    )
    expect(log).toContain('New capability discovered in this world: Blood Runes')
    expect(log).toContain('Glimpsed: Blood Runes')
    // second change resolved no node and wasn't is_new → skipped silently
    expect(db.campaignCapability.create).toHaveBeenCalledTimes(1)
  })

  it('#279: a concurrent create collision reuses the other scene\'s node instead of throwing', async () => {
    db.campaignCapability.findFirst.mockResolvedValueOnce(null) // initial resolve: nothing yet
    db.campaignCapability.create.mockRejectedValueOnce(uniqueConstraintError('campaignId_key'))
    db.campaignCapability.findFirst.mockResolvedValueOnce({ id: 'winner-node', name: 'Blood Runes' }) // re-fetch after collision
    db.characterCapability.findUnique.mockResolvedValue(null)

    const log = await applyCapabilityChanges(db as any, 'camp1', 'char1', [
      { capability_key: 'blood-runes', change: 'glimpse', is_new: true, name: 'Blood Runes', domain: 'Forbidden Arts', reason: 'saw the cultist' },
    ], 7)

    expect(db.campaignCapability.create).toHaveBeenCalledTimes(1)
    expect(db.campaignCapability.findFirst).toHaveBeenCalledTimes(2)
    // No "New capability discovered" line — the OTHER concurrent scene gets
    // credit for that log line; this call just glimpses onto the winner's node.
    expect(log).not.toContain('New capability discovered in this world: Blood Runes')
    expect(log).toContain('Glimpsed: Blood Runes')
    expect(db.characterCapability.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ capabilityId: 'winner-node' }) })
    )
  })

  it('#279: a non-unique-constraint error from create still propagates', async () => {
    db.campaignCapability.findFirst.mockResolvedValueOnce(null)
    db.campaignCapability.create.mockRejectedValueOnce(new Error('connection reset'))

    await expect(applyCapabilityChanges(db as any, 'camp1', 'char1', [
      { capability_key: 'blood-runes', change: 'glimpse', is_new: true, name: 'Blood Runes', domain: 'Forbidden Arts', reason: 'saw the cultist' },
    ], 7)).rejects.toThrow('connection reset')
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

  it('prerequisite gate: unlocking a node whose prerequisite is un-unlocked downgrades to a glimpse', async () => {
    db.campaignCapability.findFirst.mockResolvedValue({
      id: 'cap5', name: 'Riposte', tier: 2, isShadow: false,
    })
    db.characterCapability.findUnique.mockResolvedValue(null)
    db.capabilityPrerequisite.findMany.mockResolvedValue([{ prerequisiteCapabilityId: 'cap-bladework' }])
    // States of the prerequisites, then the unlocked subset used to work
    // out which ones are still missing.
    db.characterCapability.findMany
      .mockResolvedValueOnce([{ state: 'GLIMPSED' }])
      .mockResolvedValueOnce([])
    db.campaignCapability.findMany.mockResolvedValueOnce([{ name: 'Bladework' }])

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

  it('prerequisite gate: an unlocked prerequisite lets the node through', async () => {
    db.campaignCapability.findFirst.mockResolvedValue({
      id: 'cap5', name: 'Riposte', tier: 2, isShadow: false,
    })
    db.characterCapability.findUnique.mockResolvedValue(null)
    db.capabilityPrerequisite.findMany.mockResolvedValue([{ prerequisiteCapabilityId: 'cap-bladework' }])
    db.characterCapability.findMany.mockResolvedValueOnce([{ state: 'UNLOCKED' }])

    const log = await applyCapabilityChanges(db as any, 'camp1', 'char1', [
      { capability_key: 'riposte', change: 'unlock', reason: 'earned it' },
    ], 9)

    expect(db.characterCapability.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ state: 'UNLOCKED' }) })
    )
    expect(log).toEqual(['Unlocked: Riposte'])
  })

  // #372: the behaviour a tree could not express. Under parentId this node
  // could only ever name one requirement, so "Riposte needs Bladework AND
  // Footwork" had to be written as one of the two and hoped for.
  it('prerequisite gate: a node with two prerequisites stays shut while either is missing', async () => {
    db.campaignCapability.findFirst.mockResolvedValue({
      id: 'cap5', name: 'Riposte', tier: 2, isShadow: false,
    })
    db.characterCapability.findUnique.mockResolvedValue(null)
    db.capabilityPrerequisite.findMany.mockResolvedValue([
      { prerequisiteCapabilityId: 'cap-bladework' },
      { prerequisiteCapabilityId: 'cap-footwork' },
    ])
    db.characterCapability.findMany
      .mockResolvedValueOnce([{ state: 'UNLOCKED' }, { state: 'GLIMPSED' }])
      .mockResolvedValueOnce([{ capabilityId: 'cap-bladework' }])
    db.campaignCapability.findMany.mockResolvedValueOnce([{ name: 'Footwork' }])

    const log = await applyCapabilityChanges(db as any, 'camp1', 'char1', [
      { capability_key: 'riposte', change: 'unlock', reason: 'improvised in a duel' },
    ], 9)

    expect(db.characterCapability.upsert).not.toHaveBeenCalled()
    // Names only what is actually still missing. Repeating "Bladework and
    // Footwork" at a character who already has Bladework reads as a bug to
    // the player and gives the narrator nothing to act on.
    expect(log[0]).toContain('Footwork')
    expect(log[0]).not.toContain('Bladework')
  })

  it('prerequisite gate: a node with two prerequisites opens once both are unlocked', async () => {
    db.campaignCapability.findFirst.mockResolvedValue({
      id: 'cap5', name: 'Riposte', tier: 2, isShadow: false,
    })
    db.characterCapability.findUnique.mockResolvedValue(null)
    db.capabilityPrerequisite.findMany.mockResolvedValue([
      { prerequisiteCapabilityId: 'cap-bladework' },
      { prerequisiteCapabilityId: 'cap-footwork' },
    ])
    db.characterCapability.findMany.mockResolvedValueOnce([{ state: 'UNLOCKED' }, { state: 'UNLOCKED' }])

    const log = await applyCapabilityChanges(db as any, 'camp1', 'char1', [
      { capability_key: 'riposte', change: 'unlock', reason: 'earned both halves of it' },
    ], 9)

    expect(log).toEqual(['Unlocked: Riposte'])
  })

  it('prerequisite gate: a root node never looks up prerequisite states', async () => {
    db.campaignCapability.findFirst.mockResolvedValue({
      id: 'cap6', name: 'Bladework', tier: 1, isShadow: false,
    })
    db.characterCapability.findUnique.mockResolvedValue(null)
    db.capabilityPrerequisite.findMany.mockResolvedValue([])

    const log = await applyCapabilityChanges(db as any, 'camp1', 'char1', [
      { capability_key: 'bladework', change: 'unlock', reason: 'trained' },
    ], 9)

    expect(db.characterCapability.findMany).not.toHaveBeenCalled()
    expect(log).toEqual(['Unlocked: Bladework'])
  })

  it('prerequisite gate: glimpsing a gated node is never blocked', async () => {
    // Same rule as the shadow gate — anyone may learn a deeper art exists.
    db.campaignCapability.findFirst.mockResolvedValue({
      id: 'cap5', name: 'Riposte', tier: 2, isShadow: false,
    })
    db.characterCapability.findUnique.mockResolvedValue(null)

    db.capabilityPrerequisite.findMany.mockResolvedValue([{ prerequisiteCapabilityId: 'cap-bladework' }])

    const log = await applyCapabilityChanges(db as any, 'camp1', 'char1', [
      { capability_key: 'riposte', change: 'glimpse', reason: 'saw it used' },
    ], 9)

    expect(db.capabilityPrerequisite.findMany).not.toHaveBeenCalled()
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

describe('prerequisiteUnlockBlocked (#82, #372)', () => {
  it('never gates a root', () => {
    expect(prerequisiteUnlockBlocked({ prerequisiteIds: [] }, [])).toBe(false)
    expect(prerequisiteUnlockBlocked({}, null)).toBe(false)
  })

  it('blocks when the character has never met the prerequisite', () => {
    expect(prerequisiteUnlockBlocked({ prerequisiteIds: ['p'] }, [])).toBe(true)
  })

  it('blocks when the prerequisite is only glimpsed', () => {
    // Knowing the foundation EXISTS is not the same as being able to do it.
    expect(prerequisiteUnlockBlocked({ prerequisiteIds: ['p'] }, [{ state: 'GLIMPSED' }])).toBe(true)
  })

  it('allows once the prerequisite is unlocked, at any proficiency', () => {
    // Deliberately not a proficiency threshold: a numeric bar would stall a
    // branch behind the per-arc growth cap for a number no player can see.
    expect(prerequisiteUnlockBlocked({ prerequisiteIds: ['p'] }, [{ state: 'UNLOCKED' }])).toBe(false)
  })

  // #372: the whole point of the DAG. "Requires Alchemy AND Swordplay" has
  // to mean AND — a node that opened on the first prerequisite would make
  // every additional one decorative.
  it('requires ALL prerequisites, not just one', () => {
    expect(
      prerequisiteUnlockBlocked({ prerequisiteIds: ['a', 'b'] }, [{ state: 'UNLOCKED' }, { state: 'GLIMPSED' }])
    ).toBe(true)
  })

  it('allows once every prerequisite is unlocked', () => {
    expect(
      prerequisiteUnlockBlocked({ prerequisiteIds: ['a', 'b'] }, [{ state: 'UNLOCKED' }, { state: 'UNLOCKED' }])
    ).toBe(false)
  })

  it('treats a MISSING state as not-unlocked rather than absent', () => {
    // A prerequisite the character has never touched has no row at all, so
    // the caller passes fewer states than the node has prerequisites. If
    // that were read as "nothing to check", never touching a prerequisite
    // would be indistinguishable from having mastered it — the gate would
    // be strictest against players who had done the MOST.
    expect(prerequisiteUnlockBlocked({ prerequisiteIds: ['a', 'b'] }, [{ state: 'UNLOCKED' }])).toBe(true)
    expect(prerequisiteUnlockBlocked({ prerequisiteIds: ['a', 'b', 'c'] }, [])).toBe(true)
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
    ])).toEqual([{ key: 'riposte', prerequisiteKey: 'bladework' }])
  })

  it('matches the prerequisite name case- and whitespace-insensitively', () => {
    const links = resolvePrerequisiteLinks([
      { key: 'cantrips', name: 'Cantrips', domain: 'Essence Magic', tier: 1 },
      { key: 'ritual', name: 'Ritual Casting', domain: 'Essence Magic', tier: 2, requires: '  cantrips ' },
    ])
    expect(links).toEqual([{ key: 'ritual', prerequisiteKey: 'cantrips' }])
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
    expect(links).toEqual([{ key: 'b', prerequisiteKey: 'a' }])
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

// ---------------------------------------------------------------------------
// #386: a narrated node must not be born exempt from the unlock gates
// ---------------------------------------------------------------------------
//
// Created parentless and non-shadow, an AI-declared capability satisfied
// prerequisiteUnlockBlocked (false with no parentId) and shadowUnlockBlocked
// (false when not shadow) trivially — so the model could name a capability
// into existence and unlock it in the same breath, while a
// generator-authored one required groundwork and corruption. Those
// permissive defaults were written for LEGACY rows and applied to new ones
// by accident.

describe('narrated capability nodes inherit their domain (#386)', () => {
  const makeDb = () => ({
    campaignCapability: {
      findFirst: vi.fn(async () => null),
      findUnique: vi.fn(async () => null),
      findMany: vi.fn(async () => [] as any[]),
      create: vi.fn(async ({ data }: any) => ({ id: 'new-node', ...data })),
    },
    characterCapability: {
      findUnique: vi.fn(async () => null),
      count: vi.fn(async () => 0),
      create: vi.fn(async ({ data }: any) => data),
      upsert: vi.fn(async ({ create }: any) => create),
      update: vi.fn(async () => ({})),
    },
    character: { findUnique: vi.fn(async () => ({ corruption: 0 })) },
  })

  it('marks a node the narrator invented as narrated', async () => {
    const db = makeDb()

    await applyCapabilityChanges(db as any, 'camp1', 'char1', [
      { capability_key: 'blood-runes', change: 'glimpse', is_new: true, name: 'Blood Runes', domain: 'Forbidden Arts', reason: 'saw it' },
    ], 7)

    expect(db.campaignCapability.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isNarrated: true }) })
    )
  })

  it('inherits shadow-ness when every existing node in that domain is shadow', async () => {
    // If this world's Blood Sorcery is a forbidden art, a newly-named
    // branch of it is a forbidden art too — otherwise naming a new branch
    // is a way to get the forbidden thing without the corruption.
    const db = makeDb()
    db.campaignCapability.findMany.mockResolvedValue([
      { id: 'root', tier: 1, isShadow: true, _count: { prerequisites: 0 } },
    ])

    await applyCapabilityChanges(db as any, 'camp1', 'char1', [
      { capability_key: 'blood-runes', change: 'glimpse', is_new: true, name: 'Blood Runes', domain: 'Blood Sorcery', reason: 'saw it' },
    ], 7)

    expect(db.campaignCapability.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isShadow: true,
          // #372: the inherited prerequisite is written as an EDGE in the
          // same create, so the node is never briefly a root — a window in
          // which the gate would have let it through ungated.
          prerequisites: { create: [{ prerequisiteCapabilityId: 'root' }] },
        }),
      })
    )
  })

  it('does not guess a parent when the domain has several roots', async () => {
    // Guessing a position in a branching tree would be worse than leaving
    // it a root — the isNarrated gate covers the rootless case.
    const db = makeDb()
    db.campaignCapability.findMany.mockResolvedValue([
      { id: 'a', tier: 1, isShadow: false, _count: { prerequisites: 0 } },
      { id: 'b', tier: 1, isShadow: false, _count: { prerequisites: 0 } },
    ])

    await applyCapabilityChanges(db as any, 'camp1', 'char1', [
      { capability_key: 'x', change: 'glimpse', is_new: true, name: 'X', domain: 'Swordplay', reason: 'saw it' },
    ], 7)

    expect(db.campaignCapability.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isShadow: false }) })
    )
  })
})

describe('prerequisiteUnlockBlocked — narrated roots (#386)', () => {
  it('leaves a generated root ungated, as it always was', () => {
    // Every node in a campaign generated before the graph existed has no
    // prerequisites. Gating those would break existing campaigns.
    expect(prerequisiteUnlockBlocked({ prerequisiteIds: [] }, [], 0)).toBe(false)
  })

  it('blocks a narrated root for a character with no footing in its domain', () => {
    expect(prerequisiteUnlockBlocked({ prerequisiteIds: [], isNarrated: true }, [], 0)).toBe(true)
  })

  it('allows a narrated root once the character has real footing in that domain', () => {
    expect(prerequisiteUnlockBlocked({ prerequisiteIds: [], isNarrated: true }, [], 1)).toBe(false)
  })

  it('is unchanged when no domain count is supplied', () => {
    // Callers that predate this argument keep the exact pre-#386 behaviour.
    expect(prerequisiteUnlockBlocked({ prerequisiteIds: [], isNarrated: true }, [])).toBe(false)
  })
})
