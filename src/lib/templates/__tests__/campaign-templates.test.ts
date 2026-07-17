// src/lib/templates/__tests__/campaign-templates.test.ts
import { describe, it, expect, vi } from 'vitest'
import {
  createFactionsForCampaign,
  createNPCsForCampaign,
  createLocationsForCampaign,
  applyCampaignTemplate,
  type GeneratedFactionOverride,
  type GeneratedNPCOverride,
  type GeneratedLocationOverride,
} from '../campaign-templates'

function makeFaction(overrides: Partial<GeneratedFactionOverride> = {}): GeneratedFactionOverride {
  return {
    name: 'The Unbound',
    description: 'A rogue faction.',
    goals: 'Freedom',
    currentPlan: 'Recruit outsiders',
    threatLevel: 2,
    resources: 40,
    influence: 30,
    ...overrides,
  }
}

function makeMockPrisma() {
  return {
    faction: {
      create: vi.fn().mockResolvedValue({}),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    move: { create: vi.fn().mockResolvedValue({}) },
    clock: { create: vi.fn().mockResolvedValue({}) },
    campaignCapability: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
    nPC: { create: vi.fn().mockResolvedValue({}) },
    location: { create: vi.fn().mockResolvedValue({}) },
  }
}

function makeNpc(overrides: Partial<GeneratedNPCOverride> = {}): GeneratedNPCOverride {
  return {
    name: 'Lord Kessler',
    description: 'A ruthless magnate.',
    pronouns: 'he/him',
    importance: 3,
    goals: 'Expand his holdings',
    ...overrides,
  }
}

function makeLocation(overrides: Partial<GeneratedLocationOverride> = {}): GeneratedLocationOverride {
  return {
    name: 'Ashveil Keep',
    description: 'A fortified stronghold.',
    locationType: 'stronghold',
    ...overrides,
  }
}

describe('createFactionsForCampaign', () => {
  it('creates one Faction row per given faction', async () => {
    const prisma = makeMockPrisma()
    await createFactionsForCampaign('camp1', prisma, [makeFaction({ name: 'A' }), makeFaction({ name: 'B' })])

    expect(prisma.faction.create).toHaveBeenCalledTimes(2)
    expect(prisma.faction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ campaignId: 'camp1', name: 'A' }),
    })
  })

  it('is a no-op for an empty faction list', async () => {
    const prisma = makeMockPrisma()
    await createFactionsForCampaign('camp1', prisma, [])
    expect(prisma.faction.create).not.toHaveBeenCalled()
  })

  it('falls back to null when currentPlan is absent', async () => {
    const prisma = makeMockPrisma()
    await createFactionsForCampaign('camp1', prisma, [makeFaction({ currentPlan: undefined })])
    expect(prisma.faction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ currentPlan: null }),
    })
  })
})

describe('createNPCsForCampaign', () => {
  it('creates one NPC row per given npc', async () => {
    const prisma = makeMockPrisma()
    await createNPCsForCampaign('camp1', prisma, [makeNpc({ name: 'A' }), makeNpc({ name: 'B' })])
    expect(prisma.nPC.create).toHaveBeenCalledTimes(2)
    expect(prisma.nPC.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ campaignId: 'camp1', name: 'A' }),
    })
  })

  it('is a no-op for an empty npc list', async () => {
    const prisma = makeMockPrisma()
    await createNPCsForCampaign('camp1', prisma, [])
    expect(prisma.nPC.create).not.toHaveBeenCalled()
  })

  it('resolves factionName to a factionId and MEMBER role when a match exists', async () => {
    const prisma = makeMockPrisma()
    prisma.faction.findFirst.mockResolvedValue({ id: 'fac1' })
    await createNPCsForCampaign('camp1', prisma, [makeNpc({ factionName: 'The Iron Company' })])
    expect(prisma.faction.findFirst).toHaveBeenCalledWith({
      where: { campaignId: 'camp1', name: { equals: 'The Iron Company', mode: 'insensitive' } },
      select: { id: true },
    })
    expect(prisma.nPC.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ factionId: 'fac1', factionRole: 'MEMBER' }),
    })
  })

  it('leaves factionId/factionRole unset when the faction name has no match', async () => {
    const prisma = makeMockPrisma()
    prisma.faction.findFirst.mockResolvedValue(null)
    await createNPCsForCampaign('camp1', prisma, [makeNpc({ factionName: 'Nobody' })])
    expect(prisma.nPC.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ factionId: undefined, factionRole: undefined }),
    })
  })

  it('does not look up a faction when factionName is absent', async () => {
    const prisma = makeMockPrisma()
    await createNPCsForCampaign('camp1', prisma, [makeNpc({ factionName: undefined })])
    expect(prisma.faction.findFirst).not.toHaveBeenCalled()
  })
})

describe('createLocationsForCampaign', () => {
  it('creates one Location row per given location', async () => {
    const prisma = makeMockPrisma()
    await createLocationsForCampaign('camp1', prisma, [makeLocation({ name: 'A' }), makeLocation({ name: 'B' })])
    expect(prisma.location.create).toHaveBeenCalledTimes(2)
    expect(prisma.location.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ campaignId: 'camp1', name: 'A' }),
    })
  })

  it('is a no-op for an empty location list', async () => {
    const prisma = makeMockPrisma()
    await createLocationsForCampaign('camp1', prisma, [])
    expect(prisma.location.create).not.toHaveBeenCalled()
  })

  it('resolves ownerFactionName to an ownerFactionId when a match exists', async () => {
    const prisma = makeMockPrisma()
    prisma.faction.findFirst.mockResolvedValue({ id: 'fac1' })
    await createLocationsForCampaign('camp1', prisma, [makeLocation({ ownerFactionName: 'The Iron Company' })])
    expect(prisma.location.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ ownerFactionId: 'fac1' }),
    })
  })
})

describe('applyCampaignTemplate', () => {
  it('persists AI-generated factions when provided, instead of template defaults', async () => {
    const prisma = makeMockPrisma()
    const generated = [makeFaction({ name: 'The Sundered Choir' })]

    await applyCampaignTemplate('camp1', 'pbta-fantasy', prisma, generated)

    expect(prisma.faction.create).toHaveBeenCalledTimes(1)
    expect(prisma.faction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: 'The Sundered Choir' }),
    })
  })

  it('falls back to the template faction list when no AI-generated factions are given', async () => {
    const prisma = makeMockPrisma()
    await applyCampaignTemplate('camp1', 'pbta-fantasy', prisma)
    expect(prisma.faction.create).toHaveBeenCalled()
  })

  it('throws for an unknown template id', async () => {
    const prisma = makeMockPrisma()
    await expect(applyCampaignTemplate('camp1', 'not-a-real-template', prisma)).rejects.toThrow('not found')
  })

  it('seeds front-style threats as Clocks, resolving relatedFactionId (not sourceFactionId) when the named faction exists', async () => {
    const prisma = makeMockPrisma()
    prisma.faction.findFirst.mockResolvedValue({ id: 'faction-iron-co' })

    await applyCampaignTemplate('camp1', 'pbta-fantasy', prisma)

    expect(prisma.clock.create).toHaveBeenCalled()
    const calls = prisma.clock.create.mock.calls.map((c: any) => c[0].data)
    const linked = calls.find((d: any) => d.name === 'The Iron Company Tightens Its Grip')
    // relatedFactionId, deliberately NOT sourceFactionId — see the schema
    // comment: sourceFactionId would opt this clock out of the generic
    // completion event and into resolveCompletedAmbitions, which would
    // misapply faction stat deltas to it.
    expect(linked.relatedFactionId).toBe('faction-iron-co')
    expect(linked.sourceFactionId).toBeUndefined()
    expect(linked.maxTicks).toBe(6)
  })

  it('leaves relatedFactionId undefined when the named faction cannot be resolved (e.g. AI factions replaced it)', async () => {
    const prisma = makeMockPrisma() // findFirst -> null by default
    await applyCampaignTemplate('camp1', 'pbta-fantasy', prisma, [makeFaction({ name: 'Something Else Entirely' })])

    const calls = prisma.clock.create.mock.calls.map((c: any) => c[0].data)
    const linked = calls.find((d: any) => d.name === 'The Iron Company Tightens Its Grip')
    expect(linked.relatedFactionId).toBeUndefined()
    // The unlinked front (no sourceFactionName at all) still gets created.
    expect(calls.some((d: any) => d.name === "Something Wakes in the Wizard's Tower")).toBe(true)
  })

  it('skips template fronts entirely when AI generation already produced fronts', async () => {
    const prisma = makeMockPrisma()
    await applyCampaignTemplate('camp1', 'pbta-fantasy', prisma, undefined, false, true)
    expect(prisma.clock.create).not.toHaveBeenCalled()
  })

  it('seeds the template capability scaffold as a fallback when AI generation produced none', async () => {
    const prisma = makeMockPrisma()
    await applyCampaignTemplate('camp1', 'pbta-fantasy', prisma, undefined, false)

    expect(prisma.campaignCapability.createMany).toHaveBeenCalledTimes(1)
    const data = prisma.campaignCapability.createMany.mock.calls[0][0].data
    expect(data.length).toBeGreaterThan(0)
    expect(data.some((c: any) => c.name === 'Blood Rites' && c.isSecret === true)).toBe(true)
  })

  it('skips the template capability scaffold when AI already generated one', async () => {
    const prisma = makeMockPrisma()
    await applyCampaignTemplate('camp1', 'pbta-fantasy', prisma, undefined, true)
    expect(prisma.campaignCapability.createMany).not.toHaveBeenCalled()
  })
})
