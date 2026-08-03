// src/lib/ai/__tests__/chronicleNarration.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { generateChronicleNarration, validateGeneratedChronicle, buildChronicleNarrationPrompt } from '../chronicleNarration'
import type { ChronicleNarrationInput } from '@/lib/game/chronicleTypes'

vi.mock('../cost-tracker', async () => {
  const actual = await vi.importActual<typeof import('../cost-tracker')>('../cost-tracker')
  return { ...actual, recordAICost: vi.fn().mockResolvedValue(undefined) }
})

import { recordAICost } from '../cost-tracker'

function mockCompletion(content: object | string) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    }),
  })
}

const baseInput: ChronicleNarrationInput = {
  campaignTitle: 'The Iron Vigil',
  universe: 'Grimdark Fantasy',
  tension: 40,
  phase: 'rising',
  weather: { locationName: 'Greenstone', condition: 'RAIN', severity: 3 },
  factionSignals: [
    { name: 'Ironveil Guild', archetype: 'POLITICAL', goal: 'EXPAND', stability: 60, threatLevel: 40, currentPlan: 'Investigating gate anomalies' },
  ],
  activeWars: [
    { name: 'The Border Dispute', attackerName: 'Ironveil Guild', defenderName: 'Free Merchants', momentum: 20, status: 'ESCALATING' },
  ],
  recentEvents: [{ title: 'A merchant vanished', summaryPublic: 'A merchant caravan went missing near the Eastern Road.' }],
}

const validNarration = () =>
  'The rains have not let up over Greenstone in days, and the Ironveil Guild grows bolder by the hour. ' +
  'War drums beat softly at the border, favoring no one just yet. Something took a merchant on the Eastern Road, and nobody has found them.'

describe('validateGeneratedChronicle', () => {
  it('accepts a well-formed narration', () => {
    expect(validateGeneratedChronicle({ narration: validNarration() })).toBe(validNarration())
  })

  it('trims whitespace', () => {
    expect(validateGeneratedChronicle({ narration: `  ${validNarration()}  ` })).toBe(validNarration())
  })

  it('rejects a non-object', () => {
    expect(validateGeneratedChronicle(null)).toBeNull()
    expect(validateGeneratedChronicle('a string')).toBeNull()
  })

  it('rejects a missing/non-string narration field', () => {
    expect(validateGeneratedChronicle({})).toBeNull()
    expect(validateGeneratedChronicle({ narration: 123 })).toBeNull()
  })

  it('rejects a too-short narration', () => {
    expect(validateGeneratedChronicle({ narration: 'Too short.' })).toBeNull()
  })

  it('rejects a too-long narration', () => {
    expect(validateGeneratedChronicle({ narration: 'A'.repeat(2000) })).toBeNull()
  })

  it('rejects a narration that still looks like JSON', () => {
    expect(validateGeneratedChronicle({ narration: '{"still": "structured"}'.repeat(5) })).toBeNull()
  })
})

describe('buildChronicleNarrationPrompt', () => {
  it('includes weather, faction, war, and recent-event lines when present', () => {
    const { user } = buildChronicleNarrationPrompt(baseInput)
    expect(user).toContain('Greenstone')
    expect(user).toContain('Ironveil Guild')
    expect(user).toContain('Border Dispute')
    expect(user).toContain('merchant vanished')
  })

  it('omits sections that are empty', () => {
    const { user } = buildChronicleNarrationPrompt({
      ...baseInput,
      weather: null,
      factionSignals: [],
      activeWars: [],
      recentEvents: [],
    })
    expect(user).not.toContain('Weather in')
    expect(user).not.toContain('Faction activity')
    expect(user).not.toContain('Active conflicts')
    expect(user).not.toContain('Recent happenings')
  })

  it('never leaks raw numbers as the instruction to the model — system prompt forbids it', () => {
    const { system } = buildChronicleNarrationPrompt(baseInput)
    expect(system).toContain('no numbers')
  })
})

describe('generateChronicleNarration', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.mocked(recordAICost).mockClear()
  })

  it('returns null without an API key', async () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    expect(await generateChronicleNarration('camp1', baseInput)).toBeNull()
  })

  it('returns null on API error', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    expect(await generateChronicleNarration('camp1', baseInput)).toBeNull()
  })

  it('returns null on malformed JSON content', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', mockCompletion('not json'))
    expect(await generateChronicleNarration('camp1', baseInput)).toBeNull()
  })

  it('returns null when the narration fails validation', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', mockCompletion({ narration: 'Too short.' }))
    expect(await generateChronicleNarration('camp1', baseInput)).toBeNull()
  })

  it('returns the narration and records cost on success', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', mockCompletion({ narration: validNarration() }))

    const result = await generateChronicleNarration('camp1', baseInput)

    expect(result).toBe(validNarration())
    expect(recordAICost).toHaveBeenCalledTimes(1)
    expect(recordAICost).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: 'camp1', requestType: 'chronicle_narration', success: true })
    )
  })

  it('does not record cost when the response fails validation', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', mockCompletion({ narration: 'Too short.' }))
    await generateChronicleNarration('camp1', baseInput)
    expect(recordAICost).not.toHaveBeenCalled()
  })
})
