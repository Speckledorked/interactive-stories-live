// src/lib/lore/__tests__/reseedWorld.test.ts
// Fresh-vs-live faction merge planning for lore reseeds, plus the
// archetype-regeneration gate and its atomicity.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { planFactionMerge, planFrontMerge, reseedWorldFromLore } from '../reseedWorld'
import { generateWorldFromTemplate } from '@/lib/ai/worldGenerator'
import { generateWorldExtras } from '@/lib/ai/worldExtras'
import { generateMoveFlavor } from '@/lib/ai/moveFlavor'
import { generateWorldRules } from '@/lib/ai/worldRulesGenerator'
import { retrieveRelevantLore } from '@/lib/ai/loreRetrieval'
import { createNPCsForCampaign, createLocationsForCampaign } from '@/lib/templates/campaign-templates'
import { BASIC_MOVES } from '@/lib/pbta-moves'

const db = vi.hoisted(() => ({
  campaign: { findUnique: vi.fn(), update: vi.fn() },
  character: { count: vi.fn() },
  faction: { findMany: vi.fn(), updateMany: vi.fn() },
  campaignCapability: { deleteMany: vi.fn(), findMany: vi.fn(), createMany: vi.fn(), updateMany: vi.fn() },
  capabilityPrerequisite: { createMany: vi.fn() },
  clock: { findMany: vi.fn() },
  campaignArchetype: { count: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
  nPC: { findMany: vi.fn() },
  location: { findMany: vi.fn() },
  locationAdjacency: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn(), createMany: vi.fn() },
  move: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
  worldMeta: { findUnique: vi.fn() },
  $transaction: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('../loreDigest', () => ({
  buildLoreDigest: vi.fn().mockResolvedValue({ digest: 'canon excerpt', totalEntries: 3, sampledEntries: 3 }),
}))
vi.mock('@/lib/ai/loreRetrieval', () => ({
  retrieveRelevantLore: vi.fn().mockResolvedValue([]),
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
    corruptionTheme: null, advancementTrack: null,
    npcs: [],
    locations: [],
  }),
}))
vi.mock('@/lib/ai/moveFlavor', () => ({
  generateMoveFlavor: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/ai/worldRulesGenerator', () => ({
  generateWorldRules: vi.fn().mockResolvedValue(null),
  generatedRulesToWorldRules: vi.fn((rules: any[], sinceTurn: number) => ({
    rules: rules.map((r) => ({ ...r, sinceTurn })),
  })),
}))
vi.mock('@/lib/ai/worldGraphGenerator', () => ({
  generateWorldGraph: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/templates/campaign-templates', () => ({
  createFactionsForCampaign: vi.fn(),
  createNPCsForCampaign: vi.fn(),
  createLocationsForCampaign: vi.fn(),
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
      initialWorldSeed: '', statLabels: null, corruptionTheme: null, advancementTrack: null,
    })
    db.faction.findMany.mockResolvedValue([])
    db.faction.updateMany.mockResolvedValue({ count: 0 })
    db.campaignCapability.findMany.mockResolvedValue([])
    db.campaignCapability.deleteMany.mockResolvedValue({ count: 0 })
    db.campaignCapability.createMany.mockResolvedValue({ count: 0 })
    db.campaignCapability.updateMany.mockResolvedValue({ count: 0 })
    db.clock.findMany.mockResolvedValue([])
    db.nPC.findMany.mockResolvedValue([])
    db.location.findMany.mockResolvedValue([])
    db.move.findMany.mockResolvedValue([])
    db.move.deleteMany.mockResolvedValue({ count: 0 })
    db.move.createMany.mockResolvedValue({ count: 0 })
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

describe('reseedWorldFromLore — stat labels', () => {
  const canonLabels = { cool: { name: 'Recovery', description: 'x' } }

  beforeEach(() => {
    vi.clearAllMocks()
    db.campaign.findUnique.mockResolvedValue({
      id: 'camp1', title: 'Test', description: '', universe: 'Original',
      initialWorldSeed: '', statLabels: { cool: { name: 'Steady', description: 'y' } }, corruptionTheme: null, advancementTrack: null,
    })
    db.faction.findMany.mockResolvedValue([])
    db.faction.updateMany.mockResolvedValue({ count: 0 })
    db.campaignCapability.findMany.mockResolvedValue([])
    db.campaignCapability.deleteMany.mockResolvedValue({ count: 0 })
    db.campaignCapability.createMany.mockResolvedValue({ count: 0 })
    db.campaignCapability.updateMany.mockResolvedValue({ count: 0 })
    db.clock.findMany.mockResolvedValue([])
    db.nPC.findMany.mockResolvedValue([])
    db.location.findMany.mockResolvedValue([])
    db.move.findMany.mockResolvedValue([])
    db.move.deleteMany.mockResolvedValue({ count: 0 })
    db.move.createMany.mockResolvedValue({ count: 0 })
    db.campaignArchetype.count.mockResolvedValue(4)
    db.campaignArchetype.deleteMany.mockResolvedValue({ count: 0 })
    db.campaignArchetype.createMany.mockResolvedValue({ count: 1 })
    db.$transaction.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops))
    vi.mocked(generateWorldFromTemplate).mockResolvedValue({
      factions: [], capabilities: [], statLabels: canonLabels, fronts: [],
    } as any)
  })

  it('live mode leaves existing stat labels alone by default', async () => {
    db.character.count.mockResolvedValue(2)

    const result = await reseedWorldFromLore('camp1')

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.summary.statLabelsSet).toBe(false)
    expect(db.campaign.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ statLabels: expect.anything() }) })
    )
  })

  it('live mode overwrites stat labels when the admin passes forceStatLabels', async () => {
    db.character.count.mockResolvedValue(2)

    const result = await reseedWorldFromLore('camp1', { forceStatLabels: true })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.summary.statLabelsSet).toBe(true)
    expect(db.campaign.update).toHaveBeenCalledWith({
      where: { id: 'camp1' },
      data: { statLabels: canonLabels },
    })
  })

  it('fresh mode always replaces stat labels, forceStatLabels or not', async () => {
    db.character.count.mockResolvedValue(0)

    const result = await reseedWorldFromLore('camp1')

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.summary.statLabelsSet).toBe(true)
  })

  it('appends targeted stat/attribute lore to the digest passed to generation, when found', async () => {
    db.character.count.mockResolvedValue(0)
    vi.mocked(retrieveRelevantLore).mockResolvedValue([
      { id: 'l1', title: 'Attributes', content: 'Power, Speed, Spirit, Recovery', sourceUrl: null, similarity: 0.8 },
    ] as any)

    await reseedWorldFromLore('camp1')

    expect(retrieveRelevantLore).toHaveBeenCalledWith(
      'camp1',
      expect.stringMatching(/attributes/i),
      expect.objectContaining({ maxEntries: 2 })
    )
    const digestArg = vi.mocked(generateWorldFromTemplate).mock.calls[0][5]
    expect(digestArg).toContain('canon excerpt')
    expect(digestArg).toContain('Power, Speed, Spirit, Recovery')
  })

  it('does not alter the digest when no targeted stat/attribute lore is found', async () => {
    db.character.count.mockResolvedValue(0)
    vi.mocked(retrieveRelevantLore).mockResolvedValue([])

    await reseedWorldFromLore('camp1')

    const digestArg = vi.mocked(generateWorldFromTemplate).mock.calls[0][5]
    expect(digestArg).toBe('canon excerpt')
  })
})

describe('reseedWorldFromLore — NPCs and locations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.campaign.findUnique.mockResolvedValue({
      id: 'camp1', title: 'Test', description: '', universe: 'Original',
      initialWorldSeed: '', statLabels: null, corruptionTheme: null, advancementTrack: null,
    })
    db.character.count.mockResolvedValue(2) // live mode — irrelevant to NPC/location additivity
    db.faction.findMany.mockResolvedValue([])
    db.faction.updateMany.mockResolvedValue({ count: 0 })
    db.campaignCapability.findMany.mockResolvedValue([])
    db.campaignCapability.deleteMany.mockResolvedValue({ count: 0 })
    db.campaignCapability.createMany.mockResolvedValue({ count: 0 })
    db.campaignCapability.updateMany.mockResolvedValue({ count: 0 })
    db.clock.findMany.mockResolvedValue([])
    db.nPC.findMany.mockResolvedValue([])
    db.location.findMany.mockResolvedValue([])
    db.move.findMany.mockResolvedValue([])
    db.move.deleteMany.mockResolvedValue({ count: 0 })
    db.move.createMany.mockResolvedValue({ count: 0 })
    db.campaignArchetype.count.mockResolvedValue(4) // already seeded, not this test's concern
    db.campaignArchetype.deleteMany.mockResolvedValue({ count: 0 })
    db.campaignArchetype.createMany.mockResolvedValue({ count: 1 })
    db.$transaction.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops))

    vi.mocked(generateWorldExtras).mockResolvedValue({
      archetypes: [],
      corruptionTheme: null, advancementTrack: null, advancementTrackOutcome: 'declined',
      npcs: [
        { name: 'Lord Kessler', description: 'x', importance: 4 },
        { name: 'Existing Elder', description: 'y', importance: 2 },
      ],
      locations: [
        { name: 'Ashveil Keep', description: 'x' },
        { name: 'Old Market', description: 'y' },
      ],
    })
  })

  it('adds only newly-canon NPCs/locations, deduped case-insensitively against what already exists', async () => {
    db.nPC.findMany.mockResolvedValue([{ name: 'existing elder' }])
    db.location.findMany.mockResolvedValue([{ name: 'OLD MARKET' }])

    const result = await reseedWorldFromLore('camp1')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.summary.npcsAdded).toEqual(['Lord Kessler'])
      expect(result.summary.locationsAdded).toEqual(['Ashveil Keep'])
    }
    expect(createNPCsForCampaign).toHaveBeenCalledWith('camp1', db, [
      expect.objectContaining({ name: 'Lord Kessler' }),
    ])
    expect(createLocationsForCampaign).toHaveBeenCalledWith('camp1', db, [
      expect.objectContaining({ name: 'Ashveil Keep' }),
    ])
  })

  it('is a no-op when every generated NPC/location already exists', async () => {
    db.nPC.findMany.mockResolvedValue([{ name: 'Lord Kessler' }, { name: 'Existing Elder' }])
    db.location.findMany.mockResolvedValue([{ name: 'Ashveil Keep' }, { name: 'Old Market' }])

    await reseedWorldFromLore('camp1')

    expect(createNPCsForCampaign).not.toHaveBeenCalled()
    expect(createLocationsForCampaign).not.toHaveBeenCalled()
  })

  it('adds NPCs/locations even in fresh mode, alongside factions — purely additive, no retiring', async () => {
    db.character.count.mockResolvedValue(0)

    const result = await reseedWorldFromLore('camp1')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.summary.fresh).toBe(true)
      expect(result.summary.npcsAdded).toEqual(['Lord Kessler', 'Existing Elder'])
      expect(result.summary.locationsAdded).toEqual(['Ashveil Keep', 'Old Market'])
    }
  })
})

describe('reseedWorldFromLore — move flavor regeneration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.campaign.findUnique.mockResolvedValue({
      id: 'camp1', title: 'Test', description: '', universe: 'Original',
      initialWorldSeed: '', statLabels: null, corruptionTheme: null, advancementTrack: null,
    })
    db.faction.findMany.mockResolvedValue([])
    db.faction.updateMany.mockResolvedValue({ count: 0 })
    db.campaignCapability.findMany.mockResolvedValue([])
    db.campaignCapability.deleteMany.mockResolvedValue({ count: 0 })
    db.campaignCapability.createMany.mockResolvedValue({ count: 0 })
    db.campaignCapability.updateMany.mockResolvedValue({ count: 0 })
    db.clock.findMany.mockResolvedValue([])
    db.nPC.findMany.mockResolvedValue([])
    db.location.findMany.mockResolvedValue([])
    db.campaignArchetype.count.mockResolvedValue(4) // not this test's concern
    db.campaignArchetype.deleteMany.mockResolvedValue({ count: 0 })
    db.campaignArchetype.createMany.mockResolvedValue({ count: 1 })
    db.$transaction.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops))
    vi.mocked(generateMoveFlavor).mockResolvedValue([
      { baseMoveKey: 'act_under_fire', name: 'Face the Storm', trigger: 't', description: 'd', outcomes: { strongHit: 's', weakHit: 'w', miss: 'm' } },
      { baseMoveKey: 'go_aggro', name: 'Break Them', trigger: 't', description: 'd', outcomes: { strongHit: 's', weakHit: 'w', miss: 'm' } },
    ])
  })

  it('skips generation in live mode when every canonical move already has flavor', async () => {
    db.character.count.mockResolvedValue(2)
    db.move.findMany.mockResolvedValue(BASIC_MOVES.map(m => ({ baseMoveKey: m.key })))

    const result = await reseedWorldFromLore('camp1')

    expect(generateMoveFlavor).not.toHaveBeenCalled()
    if (result.ok) expect(result.summary.movesFlavored).toBe(0)
  })

  it('fills in only the missing canonical keys in live mode, without touching existing flavor', async () => {
    db.character.count.mockResolvedValue(2)
    db.move.findMany.mockResolvedValue([{ baseMoveKey: 'act_under_fire' }]) // 1 of 7 present

    const result = await reseedWorldFromLore('camp1')

    expect(generateMoveFlavor).toHaveBeenCalled()
    expect(db.move.deleteMany).not.toHaveBeenCalled()
    expect(db.move.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ baseMoveKey: 'go_aggro', name: 'Break Them' })],
    })
    if (result.ok) expect(result.summary.movesFlavored).toBe(1)
  })

  it('fresh mode replaces existing provisional flavor with the regenerated set', async () => {
    db.character.count.mockResolvedValue(0)
    db.move.findMany.mockResolvedValue([{ baseMoveKey: 'act_under_fire' }])

    const result = await reseedWorldFromLore('camp1')

    expect(db.move.deleteMany).toHaveBeenCalledWith({ where: { campaignId: 'camp1', baseMoveKey: { not: null } } })
    expect(db.move.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ baseMoveKey: 'act_under_fire', name: 'Face the Storm' }),
        expect.objectContaining({ baseMoveKey: 'go_aggro', name: 'Break Them' }),
      ],
    })
    if (result.ok) expect(result.summary.movesFlavored).toBe(2)
  })

  it('regenerates in live mode when flavor is missing entirely, even with characters already present', async () => {
    db.character.count.mockResolvedValue(2)
    db.move.findMany.mockResolvedValue([])

    const result = await reseedWorldFromLore('camp1')

    expect(generateMoveFlavor).toHaveBeenCalled()
    expect(db.move.deleteMany).not.toHaveBeenCalled()
    if (result.ok) expect(result.summary.movesFlavored).toBe(2)
  })
})

describe('reseedWorldFromLore — Phase 4 world rules generation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.faction.findMany.mockResolvedValue([])
    db.faction.updateMany.mockResolvedValue({ count: 0 })
    db.campaignCapability.findMany.mockResolvedValue([])
    db.campaignCapability.deleteMany.mockResolvedValue({ count: 0 })
    db.campaignCapability.createMany.mockResolvedValue({ count: 0 })
    db.campaignCapability.updateMany.mockResolvedValue({ count: 0 })
    db.clock.findMany.mockResolvedValue([])
    db.nPC.findMany.mockResolvedValue([])
    db.location.findMany.mockResolvedValue([])
    db.campaignArchetype.count.mockResolvedValue(4)
    db.campaignArchetype.deleteMany.mockResolvedValue({ count: 0 })
    db.campaignArchetype.createMany.mockResolvedValue({ count: 1 })
    db.move.findMany.mockResolvedValue(BASIC_MOVES.map(m => ({ baseMoveKey: m.key })))
    db.$transaction.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops))
  })

  it('generates and persists rules when the campaign has none yet', async () => {
    db.campaign.findUnique.mockResolvedValue({
      id: 'camp1', title: 'Test', description: '', universe: 'Original',
      initialWorldSeed: '', statLabels: null, corruptionTheme: null, advancementTrack: null, worldRules: null,
    })
    db.character.count.mockResolvedValue(2) // live mode — worldRules absence is what gates this, not fresh/live
    db.worldMeta.findUnique.mockResolvedValue({ currentTurnNumber: 7 })
    vi.mocked(generateWorldRules).mockResolvedValue([
      { familyKey: 'faction.leaderOptional', applies: true, confidence: 0.8, rationale: 'Hive-mind collective.' },
    ])

    const result = await reseedWorldFromLore('camp1')

    expect(db.campaign.update).toHaveBeenCalledWith({
      where: { id: 'camp1' },
      data: {
        worldRules: {
          rules: [{ familyKey: 'faction.leaderOptional', applies: true, confidence: 0.8, rationale: 'Hive-mind collective.', sinceTurn: 7 }],
        },
      },
    })
    if (result.ok) expect(result.summary.worldRulesSet).toBe(true)
  })

  it('does not regenerate in live mode when the campaign already has rules', async () => {
    db.campaign.findUnique.mockResolvedValue({
      id: 'camp1', title: 'Test', description: '', universe: 'Original',
      initialWorldSeed: '', statLabels: null, corruptionTheme: null, advancementTrack: null,
      worldRules: { rules: [{ familyKey: 'faction.leaderOptional', applies: false, confidence: 0.9, rationale: 'x', sinceTurn: 1 }] },
    })
    db.character.count.mockResolvedValue(2)

    const result = await reseedWorldFromLore('camp1')

    expect(generateWorldRules).not.toHaveBeenCalled()
    if (result.ok) expect(result.summary.worldRulesSet).toBe(false)
  })

  it('does not persist anything when generation fails (fail-open)', async () => {
    db.campaign.findUnique.mockResolvedValue({
      id: 'camp1', title: 'Test', description: '', universe: 'Original',
      initialWorldSeed: '', statLabels: null, corruptionTheme: null, advancementTrack: null, worldRules: null,
    })
    db.character.count.mockResolvedValue(0)
    vi.mocked(generateWorldRules).mockResolvedValue(null)

    const result = await reseedWorldFromLore('camp1')

    expect(db.campaign.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ worldRules: expect.anything() }) }))
    if (result.ok) expect(result.summary.worldRulesSet).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Fuzzy name reconciliation (#84)
// ---------------------------------------------------------------------------
// Matching was exact-only, which is a real problem specifically for lore
// import: canon routinely names an entity slightly differently from what
// the world generator invented. In FRESH mode exact-only could retire the
// existing faction AND create a near-duplicate under the canon spelling in
// the same pass, orphaning everything linked to the old row.

describe('planFactionMerge — fuzzy reconciliation (#84)', () => {
  it('treats a cosmetic rename as the same faction, not add + retire', () => {
    const plan = planFactionMerge(['The Ashcrown Court'], ['Ashcrown Court'], true)
    expect(plan.toAdd).toEqual([])
    expect(plan.toRetire).toEqual([])
  })

  it('tolerates punctuation and typo drift', () => {
    expect(planFactionMerge(['Kessler Syndicate'], ['Kesler Syndicate'], true).toAdd).toEqual([])
    expect(planFactionMerge(["Thieves' Guild"], ['Thieves Guild'], true).toAdd).toEqual([])
  })

  it('still treats a genuinely different faction as new', () => {
    const plan = planFactionMerge(['Ashcrown Court'], ['Ironhold Legion'], false)
    expect(plan.toAdd).toEqual(['Ironhold Legion'])
  })

  it('does not collapse two distinct short names into one', () => {
    // The fuzzy gate is ratio-based precisely so short names stay distinct.
    const plan = planFactionMerge(['Ash'], ['Oak'], false)
    expect(plan.toAdd).toEqual(['Oak'])
  })

  it('retires a genuinely absent faction in fresh mode', () => {
    const plan = planFactionMerge(['Old Guard'], ['Ironhold Legion'], true)
    expect(plan.toRetire).toEqual(['Old Guard'])
    expect(plan.toAdd).toEqual(['Ironhold Legion'])
  })

  it('never retires anything in live mode', () => {
    const plan = planFactionMerge(['Old Guard'], ['Ironhold Legion'], false)
    expect(plan.toRetire).toEqual([])
  })
})

describe('planFrontMerge — fuzzy reconciliation (#84)', () => {
  it('does not re-add a front whose name drifted cosmetically', () => {
    expect(planFrontMerge(['The Long Winter'], ['Long Winter'])).toEqual([])
  })

  it('adds a genuinely new front', () => {
    expect(planFrontMerge(['The Long Winter'], ['The Iron Tide'])).toEqual(['The Iron Tide'])
  })
})

describe('reseedWorldFromLore — capability prerequisites (#372)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.campaign.findUnique.mockResolvedValue({
      id: 'camp1', title: 'Test', description: '', universe: 'Original',
      initialWorldSeed: '', statLabels: null, corruptionTheme: null, advancementTrack: null,
    })
    db.character.count.mockResolvedValue(2) // live mode — no scaffold wipe
    db.faction.findMany.mockResolvedValue([])
    db.faction.updateMany.mockResolvedValue({ count: 0 })
    db.campaignCapability.deleteMany.mockResolvedValue({ count: 0 })
    db.campaignCapability.createMany.mockResolvedValue({ count: 0 })
    db.campaignCapability.updateMany.mockResolvedValue({ count: 0 })
    db.capabilityPrerequisite.createMany.mockResolvedValue({ count: 0 })
    db.clock.findMany.mockResolvedValue([])
    db.nPC.findMany.mockResolvedValue([])
    db.location.findMany.mockResolvedValue([])
    db.move.findMany.mockResolvedValue(BASIC_MOVES.map(m => ({ baseMoveKey: m.key })))
    db.move.deleteMany.mockResolvedValue({ count: 0 })
    db.move.createMany.mockResolvedValue({ count: 0 })
    db.campaignArchetype.count.mockResolvedValue(4)
    db.campaignArchetype.deleteMany.mockResolvedValue({ count: 0 })
    db.campaignArchetype.createMany.mockResolvedValue({ count: 1 })
    db.$transaction.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops))
  })

  const cap = (name: string, tier: number, requires?: string | string[]) => ({
    name, description: '', domain: 'Swordplay', tier, isSecret: false, requires,
  })

  // Before #372 the reseed path wrote nodes and stopped. A reseeded world
  // therefore had a completely FLAT capability graph — every node a root —
  // so the prerequisite gate did nothing at all for anyone who had ever
  // used the admin reseed button, while a freshly-created world was gated
  // normally. Same data, two different rulesets.
  it('links the prerequisites a reseed generation names', async () => {
    db.campaignCapability.findMany
      .mockResolvedValueOnce([]) // existing scaffold: empty
      .mockResolvedValueOnce([
        { id: 'id-bladework', key: 'bladework' },
        { id: 'id-footwork', key: 'footwork' },
        { id: 'id-feint', key: 'feint' },
      ])
    vi.mocked(generateWorldFromTemplate).mockResolvedValue({
      factions: [], statLabels: undefined, fronts: [],
      capabilities: [cap('Bladework', 1), cap('Footwork', 1), cap('Feint', 2, ['Bladework', 'Footwork'])],
    } as any)

    await reseedWorldFromLore('camp1')

    expect(db.capabilityPrerequisite.createMany).toHaveBeenCalledWith({
      data: [
        { capabilityId: 'id-feint', prerequisiteCapabilityId: 'id-bladework' },
        { capabilityId: 'id-feint', prerequisiteCapabilityId: 'id-footwork' },
      ],
      skipDuplicates: true,
    })
  })

  it('links a new node onto a prerequisite that already existed before the reseed', async () => {
    // The common live-mode shape: the reseed adds a deeper art to a domain
    // whose entry-level art the campaign has had all along. Resolving only
    // over the NEW rows would leave it a root.
    db.campaignCapability.findMany
      .mockResolvedValueOnce([
        { key: 'bladework', name: 'Bladework', description: null, domain: 'Swordplay', tier: 1, isSecret: false },
      ])
      .mockResolvedValueOnce([
        { id: 'id-bladework', key: 'bladework' },
        { id: 'id-riposte', key: 'riposte' },
      ])
    vi.mocked(generateWorldFromTemplate).mockResolvedValue({
      factions: [], statLabels: undefined, fronts: [],
      capabilities: [cap('Bladework', 1), cap('Riposte', 2, 'Bladework')],
    } as any)

    await reseedWorldFromLore('camp1')

    expect(db.capabilityPrerequisite.createMany).toHaveBeenCalledWith({
      data: [{ capabilityId: 'id-riposte', prerequisiteCapabilityId: 'id-bladework' }],
      skipDuplicates: true,
    })
  })

  it('writes no edges when the generation names no prerequisites', async () => {
    db.campaignCapability.findMany.mockResolvedValue([])
    vi.mocked(generateWorldFromTemplate).mockResolvedValue({
      factions: [], statLabels: undefined, fronts: [],
      capabilities: [cap('Bladework', 1), cap('Footwork', 1)],
    } as any)

    await reseedWorldFromLore('camp1')

    expect(db.capabilityPrerequisite.createMany).not.toHaveBeenCalled()
  })
})
