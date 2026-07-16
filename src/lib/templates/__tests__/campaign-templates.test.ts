// src/lib/templates/__tests__/campaign-templates.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createFactionsForCampaign, applyCampaignTemplate, type GeneratedFactionOverride } from '../campaign-templates'

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

  it('seeds front-style threats as Clocks, resolving sourceFactionId when the named faction exists', async () => {
    const prisma = makeMockPrisma()
    prisma.faction.findFirst.mockResolvedValue({ id: 'faction-iron-co' })

    await applyCampaignTemplate('camp1', 'pbta-fantasy', prisma)

    expect(prisma.clock.create).toHaveBeenCalled()
    const calls = prisma.clock.create.mock.calls.map((c: any) => c[0].data)
    const linked = calls.find((d: any) => d.name === 'The Iron Company Tightens Its Grip')
    expect(linked.sourceFactionId).toBe('faction-iron-co')
    expect(linked.maxTicks).toBe(6)
  })

  it('leaves sourceFactionId undefined when the named faction cannot be resolved (e.g. AI factions replaced it)', async () => {
    const prisma = makeMockPrisma() // findFirst -> null by default
    await applyCampaignTemplate('camp1', 'pbta-fantasy', prisma, [makeFaction({ name: 'Something Else Entirely' })])

    const calls = prisma.clock.create.mock.calls.map((c: any) => c[0].data)
    const linked = calls.find((d: any) => d.name === 'The Iron Company Tightens Its Grip')
    expect(linked.sourceFactionId).toBeUndefined()
    // The unlinked front (no sourceFactionName at all) still gets created.
    expect(calls.some((d: any) => d.name === "Something Wakes in the Wizard's Tower")).toBe(true)
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
