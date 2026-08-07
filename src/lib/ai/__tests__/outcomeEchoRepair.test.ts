// src/lib/ai/__tests__/outcomeEchoRepair.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  buildOutcomeEchoRepairPrompt,
  parseOutcomeBandAnswer,
  generateOutcomeEchoRepair,
  repairUnreportedAdherence,
} from '../outcomeEchoRepair'
import type { AdherenceResult } from '@/lib/game/outcomeAdherence'

vi.mock('../cost-tracker', async () => {
  const actual = await vi.importActual<typeof import('../cost-tracker')>('../cost-tracker')
  return { ...actual, recordAICost: vi.fn().mockResolvedValue(undefined) }
})

import { recordAICost } from '../cost-tracker'

function mockCompletion(content: string) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 80, completion_tokens: 3 },
    }),
  })
}

describe('parseOutcomeBandAnswer', () => {
  it('parses exact band names', () => {
    expect(parseOutcomeBandAnswer('strongHit')).toBe('strongHit')
    expect(parseOutcomeBandAnswer('weakHit')).toBe('weakHit')
    expect(parseOutcomeBandAnswer('miss')).toBe('miss')
  })

  it('tolerates casing, punctuation, and spacing', () => {
    expect(parseOutcomeBandAnswer('Strong Hit.')).toBe('strongHit')
    expect(parseOutcomeBandAnswer('MISS!')).toBe('miss')
    expect(parseOutcomeBandAnswer('weak-hit')).toBe('weakHit')
    expect(parseOutcomeBandAnswer('  miss  ')).toBe('miss')
  })

  it('returns null for anything that does not clearly resolve to a band', () => {
    expect(parseOutcomeBandAnswer('I am not sure')).toBeNull()
    expect(parseOutcomeBandAnswer('')).toBeNull()
    expect(parseOutcomeBandAnswer('strong')).toBeNull()
  })
})

describe('buildOutcomeEchoRepairPrompt', () => {
  it('includes the scene text, character name, and the actually-rolled band', () => {
    const { user } = buildOutcomeEchoRepairPrompt({
      sceneText: 'Kess ducks behind the crate as the shot goes wide.',
      characterName: 'Kess',
      rolledOutcome: 'miss',
    })
    expect(user).toContain('Kess ducks behind the crate')
    expect(user).toContain('Kess')
    expect(user).toContain('miss')
  })

  it('tells the model to answer based on its own prose, not the roll', () => {
    const { system, user } = buildOutcomeEchoRepairPrompt({
      sceneText: 'x', characterName: 'Kess', rolledOutcome: 'miss',
    })
    expect(system).toMatch(/one word/i)
    expect(user).toMatch(/not that/i)
  })
})

describe('generateOutcomeEchoRepair', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.mocked(recordAICost).mockClear()
  })

  const ctx = { sceneText: 'Kess ducks behind the crate.', characterName: 'Kess', rolledOutcome: 'miss' as const }

  it('returns null without an API key', async () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    expect(await generateOutcomeEchoRepair('camp1', ctx)).toBeNull()
  })

  it('returns null on API error', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    expect(await generateOutcomeEchoRepair('camp1', ctx)).toBeNull()
  })

  it('returns null when the answer does not parse as a real band', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', mockCompletion('I really am not sure honestly'))
    expect(await generateOutcomeEchoRepair('camp1', ctx)).toBeNull()
    expect(recordAICost).not.toHaveBeenCalled()
  })

  it('returns the parsed band and records cost on success', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', mockCompletion('weakHit'))
    const result = await generateOutcomeEchoRepair('camp1', ctx)
    expect(result).toBe('weakHit')
    expect(recordAICost).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: 'camp1', requestType: 'outcome_echo_repair', success: true })
    )
  })
})

describe('repairUnreportedAdherence', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  function makeAdherence(overrides: Partial<AdherenceResult> = {}): AdherenceResult {
    return {
      entries: [{ characterName: 'Kess', rolled: 'miss', narrated: null, verdict: 'unreported' }],
      matched: 0, mismatched: 0, unreported: 1, ambiguous: 0, problems: [],
      ...overrides,
    }
  }

  it('returns the same object by reference when there is nothing unreported', async () => {
    const adherence = makeAdherence({ entries: [], unreported: 0 })
    const result = await repairUnreportedAdherence('camp1', 'scene text', adherence)
    expect(result).toBe(adherence)
  })

  it('upgrades an unreported entry to match when the backfilled band agrees with the roll', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', mockCompletion('miss'))
    const result = await repairUnreportedAdherence('camp1', 'Kess ducks and the shot goes wide.', makeAdherence())
    expect(result.entries[0]).toEqual({ characterName: 'Kess', rolled: 'miss', narrated: 'miss', verdict: 'match' })
    expect(result.matched).toBe(1)
    expect(result.unreported).toBe(0)
  })

  it('upgrades an unreported entry to mismatch when the backfilled band disagrees, and logs a problem', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', mockCompletion('strongHit'))
    const result = await repairUnreportedAdherence('camp1', 'Kess lands a clean hit.', makeAdherence())
    expect(result.entries[0].verdict).toBe('mismatch')
    expect(result.mismatched).toBe(1)
    expect(result.unreported).toBe(0)
    expect(result.problems[0]).toContain('backfilled')
  })

  it('leaves an entry unreported when the repair call itself fails open', async () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    const original = makeAdherence()
    const result = await repairUnreportedAdherence('camp1', 'scene text', original)
    expect(result.entries[0].verdict).toBe('unreported')
    expect(result.unreported).toBe(1)
    expect(result.matched).toBe(0)
  })

  it('never touches an already-matched or mismatched entry', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', mockCompletion('miss'))
    const adherence = makeAdherence({
      entries: [
        { characterName: 'Kess', rolled: 'miss', narrated: null, verdict: 'unreported' },
        { characterName: 'Dorn', rolled: 'strongHit', narrated: 'strongHit', verdict: 'match' },
      ],
      matched: 1, unreported: 1,
    })
    const result = await repairUnreportedAdherence('camp1', 'scene text', adherence)
    expect(result.entries[1]).toEqual(adherence.entries[1])
  })

  it('caps repair attempts at MAX_REPAIR_ATTEMPTS_PER_SCENE even with more unreported entries', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    const fetchMock = mockCompletion('miss')
    vi.stubGlobal('fetch', fetchMock)
    const adherence = makeAdherence({
      entries: Array.from({ length: 5 }, (_, i) => ({
        characterName: `Char${i}`, rolled: 'miss' as const, narrated: null, verdict: 'unreported' as const,
      })),
      unreported: 5,
    })
    const result = await repairUnreportedAdherence('camp1', 'scene text', adherence)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(result.unreported).toBe(2)
  })
})
