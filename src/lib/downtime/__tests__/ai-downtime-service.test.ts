// src/lib/downtime/__tests__/ai-downtime-service.test.ts
// getPersonalizedSuggestions used to be a hardcoded list of 10 generic
// activities, ignoring the character entirely. Covers the real
// AI-generated, character-specific replacement and its fallback.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { findUniqueMock, findFirstMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  findFirstMock: vi.fn(),
}))

vi.mock('@prisma/client', () => ({
  PrismaClient: class {
    character = { findUnique: findUniqueMock }
    scene = { findFirst: findFirstMock }
  },
}))

vi.mock('@/lib/game/capabilities', () => ({
  summarizeCapabilities: vi.fn().mockReturnValue({ known: [], glimpsed: [], knownDomains: [] }),
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
