// src/lib/downtime/__tests__/ai-downtime-service.test.ts
// getPersonalizedSuggestions used to be a hardcoded list of 10 generic
// activities, ignoring the character entirely. Covers the real
// AI-generated, character-specific replacement and its fallback.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const {
  findUniqueMock, findFirstMock, updateMock, activityCreateMock,
  worldMetaFindUniqueMock, questCreateMock, applyDebtChangesMock,
  activityFindManyMock, activityUpdateMock, questFindUniqueMock,
} = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  findFirstMock: vi.fn(),
  updateMock: vi.fn(),
  activityCreateMock: vi.fn(),
  worldMetaFindUniqueMock: vi.fn(),
  questCreateMock: vi.fn(),
  applyDebtChangesMock: vi.fn(),
  activityFindManyMock: vi.fn(),
  activityUpdateMock: vi.fn(),
  questFindUniqueMock: vi.fn(),
}))

vi.mock('@prisma/client', () => ({
  PrismaClient: class {
    character = { findUnique: findUniqueMock, update: updateMock }
    scene = { findFirst: findFirstMock }
    downtimeActivity = { create: activityCreateMock, findMany: activityFindManyMock, update: activityUpdateMock }
    worldMeta = { findUnique: worldMetaFindUniqueMock }
    quest = { create: questCreateMock, findUnique: questFindUniqueMock }
  },
}))

vi.mock('@/lib/game/capabilities', () => ({
  summarizeCapabilities: vi.fn().mockReturnValue({ known: [], glimpsed: [], knownDomains: [] }),
}))

vi.mock('@/lib/game/debts', () => ({
  applyDebtChanges: applyDebtChangesMock,
}))

import { AIDrivenDowntimeService } from '../ai-downtime-service'

function mockCompletion(content: object) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(content) } }] }),
  })
}

describe('getPersonalizedSuggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    findFirstMock.mockResolvedValue(null)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('falls back to generic suggestions when the character is missing', async () => {
    findUniqueMock.mockResolvedValue(null)
    const result = await AIDrivenDowntimeService.getPersonalizedSuggestions('missing-id')
    expect(result.length).toBeGreaterThan(0)
    expect(result).toEqual(expect.arrayContaining([expect.any(String)]))
  })

  it('asks the AI for suggestions grounded in this specific character', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    findUniqueMock.mockResolvedValue({
      id: 'char1',
      campaignId: 'camp1',
      name: 'Helios',
      description: 'A newly awakened essence user',
      backstory: 'Grew up an outsider to the Verse',
      personality: 'Cautious',
      goals: 'Find others like him',
      currentLocation: 'The Hollow Bridge',
      resources: { gold: 40 },
      campaign: { universe: 'He Who Fights With Monsters', description: null },
      capabilities: [],
    })
    const fetchSpy = mockCompletion({
      suggestions: [
        'I search the market for essence-attuned trinkets',
        'I ask around about the Hollow Bridge incident',
        'I try meditating to sense my essence again',
        'I look for others who might share my condition',
        'I rest and process what happened last session',
      ],
    })
    vi.stubGlobal('fetch', fetchSpy)

    const result = await AIDrivenDowntimeService.getPersonalizedSuggestions('char1')

    expect(result).toHaveLength(5)
    expect(result[0]).toContain('essence')
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as any).body)
    expect(body.messages[0].content).toContain('Helios')
    expect(body.messages[0].content).toContain('Grew up an outsider')
    expect(body.messages[0].content).toContain('He Who Fights With Monsters')
  })

  it('falls back to generic suggestions when the API call fails', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    findUniqueMock.mockResolvedValue({
      id: 'char1', campaignId: 'camp1', name: 'Helios', resources: {},
      campaign: { universe: 'Test' }, capabilities: [],
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))

    const result = await AIDrivenDowntimeService.getPersonalizedSuggestions('char1')
    expect(result.length).toBeGreaterThan(0)
  })

  it('falls back to generic suggestions when fetch throws', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    findUniqueMock.mockResolvedValue({
      id: 'char1', campaignId: 'camp1', name: 'Helios', resources: {},
      campaign: { universe: 'Test' }, capabilities: [],
    })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    const result = await AIDrivenDowntimeService.getPersonalizedSuggestions('char1')
    expect(result.length).toBeGreaterThan(0)
  })
})

describe('createDynamicActivity — gold cost', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    activityCreateMock.mockResolvedValue({ id: 'activity1' })
    // generateInitialEvents is a full AI-call pipeline unrelated to what
    // this suite covers (gold charging) — treated as a black box, same
    // pattern used elsewhere in this codebase for sibling subsystems.
    vi.spyOn(AIDrivenDowntimeService as any, 'generateInitialEvents').mockResolvedValue(undefined)
  })

  function stubInterpretation(costs: Record<string, unknown>) {
    return vi.spyOn(AIDrivenDowntimeService, 'interpretDowntimeActivity').mockResolvedValue({
      success: true,
      interpretation: {
        summary: 'Train at the local guild',
        estimatedDuration: 3,
        costs,
        requirements: [],
        skillsInvolved: [],
        riskLevel: 'low',
        potentialOutcomes: [],
        potentialComplications: [],
        isViable: true,
        aiNotes: '',
      },
    } as any)
  }

  it('charges gold and creates the activity when affordable — previously nothing ever deducted it', async () => {
    stubInterpretation({ gold: 20 })
    findUniqueMock.mockResolvedValue({ resources: { gold: 50 } })
    updateMock.mockResolvedValue({})

    await AIDrivenDowntimeService.createDynamicActivity('char1', 'I train at the guild')

    expect(updateMock).toHaveBeenCalledWith({
      where: { id: 'char1' },
      data: { resources: { gold: 30 } },
    })
    expect(activityCreateMock).toHaveBeenCalled()
  })

  it('rejects the activity when the character cannot afford it, without creating it', async () => {
    stubInterpretation({ gold: 100 })
    findUniqueMock.mockResolvedValue({ resources: { gold: 10 } })

    await expect(
      AIDrivenDowntimeService.createDynamicActivity('char1', 'I hire mercenaries')
    ).rejects.toThrow('Not enough gold')

    expect(updateMock).not.toHaveBeenCalled()
    expect(activityCreateMock).not.toHaveBeenCalled()
  })

  it('skips the gold check entirely for free activities', async () => {
    stubInterpretation({ gold: 0 })
    findUniqueMock.mockResolvedValue({ resources: { gold: 0 } })

    await AIDrivenDowntimeService.createDynamicActivity('char1', 'I rest at the inn')

    expect(updateMock).not.toHaveBeenCalled()
    expect(activityCreateMock).toHaveBeenCalled()
  })

  it('charges consumed items from inventory', async () => {
    stubInterpretation({ items: [{ name: 'Iron Ore', quantity: 2 }] })
    findUniqueMock.mockResolvedValue({
      resources: {},
      inventory: { items: [{ id: 'i1', name: 'Iron Ore', quantity: 5 }] },
    })
    updateMock.mockResolvedValue({})

    await AIDrivenDowntimeService.createDynamicActivity('char1', 'I forge a dagger')

    expect(updateMock).toHaveBeenCalledWith({
      where: { id: 'char1' },
      data: { inventory: { items: [{ id: 'i1', name: 'Iron Ore', quantity: 3 }] } },
    })
  })

  it('rejects when an item cost is unaffordable, case-insensitively matched, without creating the activity', async () => {
    stubInterpretation({ items: [{ name: 'iron ore', quantity: 10 }] })
    findUniqueMock.mockResolvedValue({
      resources: {},
      inventory: { items: [{ id: 'i1', name: 'Iron Ore', quantity: 2 }] },
    })

    await expect(
      AIDrivenDowntimeService.createDynamicActivity('char1', 'I forge a dagger')
    ).rejects.toThrow('Not enough')

    expect(updateMock).not.toHaveBeenCalled()
    expect(activityCreateMock).not.toHaveBeenCalled()
  })

  it('removes an item entirely once its quantity is fully consumed', async () => {
    stubInterpretation({ items: [{ name: 'Iron Ore', quantity: 5 }] })
    findUniqueMock.mockResolvedValue({
      resources: {},
      inventory: { items: [{ id: 'i1', name: 'Iron Ore', quantity: 5 }] },
    })
    updateMock.mockResolvedValue({})

    await AIDrivenDowntimeService.createDynamicActivity('char1', 'I forge a sword')

    expect(updateMock).toHaveBeenCalledWith({
      where: { id: 'char1' },
      data: { inventory: { items: [] } },
    })
  })

  it('incurs a debt as payment for a favor — never blocked by affordability', async () => {
    stubInterpretation({
      favor: { counterparty_name: 'Lord Kessler', counterparty_type: 'npc', description: 'Vouching for the character' },
    })
    findUniqueMock.mockResolvedValue({ name: 'Helios', campaignId: 'camp1', resources: {} })
    worldMetaFindUniqueMock.mockResolvedValue({ currentTurnNumber: 5 })

    const activity = await AIDrivenDowntimeService.createDynamicActivity('char1', 'I call in a favor for guild access')

    expect(applyDebtChangesMock).toHaveBeenCalledWith(
      expect.anything(),
      'camp1',
      'char1',
      'Helios',
      [expect.objectContaining({
        counterparty_name: 'Lord Kessler',
        direction: 'owed_by_character',
        action: 'incur',
      })],
      5
    )
    expect(activityCreateMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        requirements: expect.arrayContaining([expect.stringContaining('Lord Kessler')]),
      }),
    }))
  })

  it('spawns a real, tracked quest when the activity requires an external mission', async () => {
    stubInterpretation({
      requiresQuest: { name: 'Find the Ashenvale Ore', description: 'Track down rare ore', givenBy: null },
    })
    findUniqueMock.mockResolvedValue({ name: 'Helios', campaignId: 'camp1', resources: {} })
    questCreateMock.mockResolvedValue({ id: 'quest1' })

    await AIDrivenDowntimeService.createDynamicActivity('char1', 'I commission a masterwork blade')

    expect(questCreateMock).toHaveBeenCalledWith({
      data: {
        campaignId: 'camp1',
        name: 'Find the Ashenvale Ore',
        description: 'Track down rare ore',
        givenBy: null,
        status: 'ACTIVE',
      },
    })
    expect(activityCreateMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ linkedQuestId: 'quest1' }),
    }))
  })
})

describe('advanceDynamicDowntime — quest-gated activities', () => {
  function baseActivity(overrides: Record<string, unknown> = {}) {
    return {
      id: 'activity1',
      characterId: 'char1',
      summary: 'Commission a masterwork blade',
      description: 'Commission a masterwork blade',
      currentDay: 0,
      estimatedDays: 3,
      linkedQuestId: 'quest1',
      outcomes: { aiInterpretation: { skillsInvolved: [] } },
      events: [],
      ...overrides,
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    activityUpdateMock.mockResolvedValue({})
    // Event/outcome generation is its own AI pipeline, out of scope for
    // gating logic — stubbed deterministic so day-advancement is testable
    // without a real completion/event roll.
    vi.spyOn(AIDrivenDowntimeService, 'generateDynamicEvent').mockResolvedValue(null)
    vi.spyOn(AIDrivenDowntimeService, 'generateDynamicOutcomes').mockResolvedValue({ primaryOutcome: 'Done' } as any)
  })

  it('blocks completion while the linked quest is still active, even once all days have passed', async () => {
    activityFindManyMock.mockResolvedValue([baseActivity({ currentDay: 3, estimatedDays: 3 })])
    questFindUniqueMock.mockResolvedValue({ status: 'ACTIVE', name: 'Find the Ashenvale Ore' })

    const results = await AIDrivenDowntimeService.advanceDynamicDowntime('char1', 1)

    expect(activityUpdateMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED' }) })
    )
    expect(results.some((r: any) => r.completed)).toBe(false)
  })

  it('lets days (and their events) still advance while blocked, capped just short of completion', async () => {
    activityFindManyMock.mockResolvedValue([baseActivity({ currentDay: 0, estimatedDays: 3 })])
    questFindUniqueMock.mockResolvedValue({ status: 'ACTIVE', name: 'Find the Ashenvale Ore' })

    await AIDrivenDowntimeService.advanceDynamicDowntime('char1', 5)

    expect(activityUpdateMock).toHaveBeenCalledWith({
      where: { id: 'activity1' },
      data: { currentDay: 2 }, // estimatedDays - 1, never reaches 3
    })
  })

  it('completes normally once the linked quest resolves', async () => {
    activityFindManyMock.mockResolvedValue([baseActivity({ currentDay: 2, estimatedDays: 3 })])
    questFindUniqueMock.mockResolvedValue({ status: 'COMPLETED', name: 'Find the Ashenvale Ore' })

    const results = await AIDrivenDowntimeService.advanceDynamicDowntime('char1', 1)

    expect(activityUpdateMock).toHaveBeenCalledWith({
      where: { id: 'activity1' },
      data: { currentDay: 3, status: 'COMPLETED', completedAt: expect.any(Date) },
    })
    expect(results.some((r: any) => r.completed)).toBe(true)
  })

  it('fails the activity outright when the linked quest fails', async () => {
    activityFindManyMock.mockResolvedValue([baseActivity()])
    questFindUniqueMock.mockResolvedValue({ status: 'FAILED', name: 'Find the Ashenvale Ore' })

    const results = await AIDrivenDowntimeService.advanceDynamicDowntime('char1', 1)

    expect(activityUpdateMock).toHaveBeenCalledWith({
      where: { id: 'activity1' },
      data: { status: 'FAILED', completedAt: expect.any(Date) },
    })
    expect(results[0]).toMatchObject({ completed: true })
    expect(results[0].outcomes.primaryOutcome).toContain('failed')
  })

  it('activities without a linked quest are unaffected', async () => {
    activityFindManyMock.mockResolvedValue([baseActivity({ linkedQuestId: null, currentDay: 2, estimatedDays: 3 })])

    await AIDrivenDowntimeService.advanceDynamicDowntime('char1', 1)

    expect(questFindUniqueMock).not.toHaveBeenCalled()
    expect(activityUpdateMock).toHaveBeenCalledWith({
      where: { id: 'activity1' },
      data: { currentDay: 3, status: 'COMPLETED', completedAt: expect.any(Date) },
    })
  })
})
