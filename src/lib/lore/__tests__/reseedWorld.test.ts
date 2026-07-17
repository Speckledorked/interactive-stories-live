// src/lib/lore/__tests__/reseedWorld.test.ts
// Fresh-vs-live faction merge planning for lore reseeds, plus the
// archetype-regeneration gate and its atomicity.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { planFactionMerge, planFrontMerge, reseedWorldFromLore } from '../reseedWorld'

const db = vi.hoisted(() => ({
  campaign: { findUnique: vi.fn(), update: vi.fn() },
  character: { count: vi.fn() },
  faction: { findMany: vi.fn(), updateMany: vi.fn() },
  campaignCapability: { deleteMany: vi.fn(), findMany: vi.fn(), createMany: vi.fn(), updateMany: vi.fn() },
  clock: { findMany: vi.fn() },
  campaignArchetype: { count: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
  $transaction: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('../loreDigest', () => ({
  buildLoreDigest: vi.fn().mockResolvedValue({ digest: 'canon excerpt', totalEntries: 3, sampledEntries: 3 }),
}))
vi.mock('@/lib/ai/worldGenerator', () => ({
  generateWorldFromTemplate: vi.fn().mockResolvedValue({
    factions: [], capabilities: [], statLabels: undefined, fronts: [],
  }),
}))
vi.mock('@/lib/ai/worldExtras', () => ({
  generateWorldExtras: vi.fn().mockResolvedValue({
    archetypes: [{
      name: 'Newly Awakened Outworlder',
      description: 'A stranger to this world.',
      originFamiliarity: 'OUTSIDER',
      suggestedStats: null,
      startingGear: null,
      startingTie: null,
      backstoryPrompts: [],
      glimpseCapabilityKeys: [],
    }],
    corruptionTheme: null,
  }),
}))
vi.mock('@/lib/templates/campaign-templates', () => ({
  createFactionsForCampaign: vi.fn(),
}))

describe('planFactionMerge', () => {
  const existing = ['The Ashveil Syndicate', 'House Venture']
  const generated = ['House Venture', 'House Elariel', 'The Steel Ministry']

  it('live mode: adds unknown canon factions, retires nothing', () => {
    const plan = planFactionMerge(existing, generated, false)
    expect(plan.toAdd).toEqual(['House Elariel', 'The Steel Ministry'])
    expect(plan.toRetire).toEqual([])
  })

  it('fresh mode: also retires non-canon leftovers', () => {
    const plan = planFactionMerge(existing, generated, true)
    expect(plan.toAdd).toEqual(['House Elariel', 'The Steel Ministry'])
    expect(plan.toRetire).toEqual(['The Ashveil Syndicate'])
  })

  it('matches names case-insensitively (canon name keeps the existing row)', () => {
    const plan = planFactionMerge(['house venture'], ['House Venture'], true)
    expect(plan.toAdd).toEqual([])
    expect(plan.toRetire).toEqual([])
  })

  it('handles empty inputs', () => {
    expect(planFactionMerge([], generated, true).toAdd).toHaveLength(3)
    expect(planFactionMerge(existing, [], true).toRetire).toEqual(existing)
    expect(planFactionMerge(existing, [], false).toRetire).toEqual([])
  })
})

describe('planFrontMerge', () => {
  it('keeps only fronts not already present, case-insensitively', () => {
    const existing = ['The Iron Company Tightens Its Grip']
    const generated = ['the iron company tightens its grip', 'A New Canon Threat']
    expect(planFrontMerge(existing, generated)).toEqual(['A New Canon Threat'])
  })

  it('is purely additive — never returns anything to retire, unlike factions', () => {
    expect(planFrontMerge(['Existing Front'], [])).toEqual([])
  })

  it('handles empty inputs', () => {
    expect(planFrontMerge([], ['Front A', 'Front B'])).toEqual(['Front A', 'Front B'])
    expect(planFrontMerge(['Front A'], [])).toEqual([])
  })
})

describe('reseedWorldFromLore — archetype regeneration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.campaign.findUnique.mockResolvedValue({
      id: 'camp1', title: 'Test', description: '', universe: 'Original',
      initialWorldSeed: '', statLabels: null, corruptionTheme: null,
    })
    db.faction.findMany.mockResolvedValue([])
    db.faction.updateMany.mockResolvedValue({ count: 0 })
    db.campaignCapability.findMany.mockResolvedValue([])
    db.campaignCapability.deleteMany.mockResolvedValue({ count: 0 })
    db.campaignCapability.createMany.mockResolvedValue({ count: 0 })
    db.campaignCapability.updateMany.mockResolvedValue({ count: 0 })
    db.clock.findMany.mockResolvedValue([])
    db.campaignArchetype.deleteMany.mockResolvedValue({ count: 0 })
    db.campaignArchetype.createMany.mockResolvedValue({ count: 1 })
    // Real prisma $transaction([p1, p2]) resolves to [result1, result2].
    db.$transaction.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops))
  })

  it('fresh mode (no characters yet) regenerates archetypes', async () => {
    db.character.count.mockResolvedValue(0)
    db.campaignArchetype.count.mockResolvedValue(4) // provisional ones from creation

    const result = await reseedWorldFromLore('camp1')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.summary.fresh).toBe(true)
      expect(result.summary.archetypesReplaced).toBe(1)
    }
    expect(db.campaignArchetype.deleteMany).toHaveBeenCalledWith({ where: { campaignId: 'camp1' } })
  })

  it('live mode with existing archetypes leaves them alone', async () => {
    db.character.count.mockResolvedValue(2)
    db.campaignArchetype.count.mockResolvedValue(4)

    const result = await reseedWorldFromLore('camp1')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.summary.fresh).toBe(false)
      expect(result.summary.archetypesSkipped).toBe(true)
      expect(result.summary.archetypesReplaced).toBe(0)
    }
    expect(db.campaignArchetype.deleteMany).not.toHaveBeenCalled()
  })

  it('live mode with ZERO archetypes regenerates them anyway — the admin re-run button is a real recovery path even after characters exist', async () => {
    db.character.count.mockResolvedValue(2)
    db.campaignArchetype.count.mockResolvedValue(0)

    const result = await reseedWorldFromLore('camp1')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.summary.fresh).toBe(false)
      expect(result.summary.archetypesSkipped).toBe(false)
      expect(result.summary.archetypesReplaced).toBe(1)
    }
    expect(db.campaignArchetype.deleteMany).toHaveBeenCalledWith({ where: { campaignId: 'camp1' } })
  })

  it('deletes and recreates archetypes inside a single transaction, not two independent writes', async () => {
    db.character.count.mockResolvedValue(0)
    db.campaignArchetype.count.mockResolvedValue(0)

    await reseedWorldFromLore('camp1')

    expect(db.$transaction).toHaveBeenCalledTimes(1)
    expect(db.$transaction).toHaveBeenCalledWith([
      expect.any(Promise),
      expect.any(Promise),
    ])
  })
})
