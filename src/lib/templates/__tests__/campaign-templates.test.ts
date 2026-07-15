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
    faction: { create: vi.fn().mockResolvedValue({}) },
    move: { create: vi.fn().mockResolvedValue({}) },
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
})
