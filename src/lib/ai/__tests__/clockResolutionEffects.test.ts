// src/lib/ai/__tests__/clockResolutionEffects.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  generateClockResolutionEffects,
  validateGeneratedClockEffects,
  buildClockResolutionPrompt,
  type ClockResolutionContext,
} from '../clockResolutionEffects'

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

const baseContext: ClockResolutionContext = {
  campaignTitle: 'The Iron Vigil',
  universe: 'Grimdark Fantasy',
  clockName: 'The Silver Landing',
  clockDescription: 'A crash site outside town.',
  clockConsequence: 'A local breach stabilizes and begins spilling hazardous astral effects into nearby streets and farms.',
  clockGmNotes: null,
  clockCategory: 'urgent',
  knownLocationNames: ['Greenstone', 'The Old Mill'],
  knownFactionNames: ['Astral Survey Office'],
}

describe('validateGeneratedClockEffects', () => {
  it('rejects a non-object or missing effects array', () => {
    expect(validateGeneratedClockEffects(null)).toBeNull()
    expect(validateGeneratedClockEffects('a string')).toBeNull()
    expect(validateGeneratedClockEffects({})).toBeNull()
    expect(validateGeneratedClockEffects({ effects: 'not an array' })).toBeNull()
  })

  it('accepts an empty effects array (zero effects is valid)', () => {
    expect(validateGeneratedClockEffects({ effects: [] })).toEqual([])
  })

  it('validates a well-formed SPAWN_CLOCK effect', () => {
    const result = validateGeneratedClockEffects({
      effects: [{ type: 'SPAWN_CLOCK', name: 'Astral Contamination Spreads', max_ticks: 5, consequence: 'The breach widens.', category: 'urgent', reason: 'unresolved threat' }],
    })
    expect(result).toEqual([
      { type: 'SPAWN_CLOCK', reason: 'unresolved threat', name: 'Astral Contamination Spreads', consequence: 'The breach widens.', category: 'urgent', maxTicks: 5 },
    ])
  })

  it('drops a SPAWN_CLOCK effect missing name or consequence', () => {
    expect(validateGeneratedClockEffects({ effects: [{ type: 'SPAWN_CLOCK', consequence: 'x' }] })).toEqual([])
    expect(validateGeneratedClockEffects({ effects: [{ type: 'SPAWN_CLOCK', name: 'x' }] })).toEqual([])
  })

  it('clamps max_ticks to the 3-8 bound', () => {
    const result = validateGeneratedClockEffects({
      effects: [{ type: 'SPAWN_CLOCK', name: 'x', consequence: 'y', max_ticks: 999 }],
    })
    expect(result![0].maxTicks).toBe(8)
  })

  it('validates a well-formed LOCATION_EFFECT and drops one missing a target', () => {
    const result = validateGeneratedClockEffects({
      effects: [{ type: 'LOCATION_EFFECT', target_location_name: 'Greenstone', condition_delta: -10, reason: 'fallout' }],
    })
    expect(result).toEqual([{ type: 'LOCATION_EFFECT', reason: 'fallout', targetLocationName: 'Greenstone', conditionDelta: -10 }])

    expect(validateGeneratedClockEffects({ effects: [{ type: 'LOCATION_EFFECT', condition_delta: -10 }] })).toEqual([])
  })

  it('clamps condition_delta to ±15', () => {
    const result = validateGeneratedClockEffects({
      effects: [{ type: 'LOCATION_EFFECT', target_location_name: 'Greenstone', condition_delta: -999 }],
    })
    expect(result![0].conditionDelta).toBe(-15)
  })

  it('validates a well-formed FACTION_EFFECT and drops one missing a target', () => {
    const result = validateGeneratedClockEffects({
      effects: [{ type: 'FACTION_EFFECT', target_faction_name: 'Astral Survey Office', threat_level_delta: 1, reason: 'escalation' }],
    })
    expect(result).toEqual([
      { type: 'FACTION_EFFECT', reason: 'escalation', targetFactionName: 'Astral Survey Office', resourceDelta: 0, stabilityDelta: 0, militaryDelta: 0, threatLevelDelta: 1 },
    ])

    expect(validateGeneratedClockEffects({ effects: [{ type: 'FACTION_EFFECT', threat_level_delta: 1 }] })).toEqual([])
  })

  it('drops a FACTION_EFFECT whose deltas are all zero (nothing to apply)', () => {
    expect(
      validateGeneratedClockEffects({ effects: [{ type: 'FACTION_EFFECT', target_faction_name: 'Astral Survey Office' }] })
    ).toEqual([])
  })

  it('drops an entry with an unrecognized type', () => {
    expect(validateGeneratedClockEffects({ effects: [{ type: 'DELETE_CAMPAIGN', name: 'x' }] })).toEqual([])
  })

  it('salvages valid entries alongside invalid ones instead of discarding the whole batch', () => {
    const result = validateGeneratedClockEffects({
      effects: [
        { type: 'NOT_A_TYPE' },
        { type: 'FACTION_EFFECT', target_faction_name: 'Astral Survey Office', resource_delta: 5 },
      ],
    })
    expect(result).toHaveLength(1)
    expect(result![0].type).toBe('FACTION_EFFECT')
  })

  it('caps at MAX_EFFECTS_PER_CLOCK even if the model returns more', () => {
    const result = validateGeneratedClockEffects({
      effects: [
        { type: 'FACTION_EFFECT', target_faction_name: 'A', resource_delta: 1 },
        { type: 'FACTION_EFFECT', target_faction_name: 'B', resource_delta: 1 },
        { type: 'FACTION_EFFECT', target_faction_name: 'C', resource_delta: 1 },
      ],
    })
    expect(result).toHaveLength(2)
  })
})

describe('buildClockResolutionPrompt', () => {
  it('includes the clock consequence and known entity names', () => {
    const { user } = buildClockResolutionPrompt(baseContext)
    expect(user).toContain('hazardous astral effects')
    expect(user).toContain('Greenstone')
    expect(user).toContain('Astral Survey Office')
  })

  it('tells the model it may return zero effects and never invent a name', () => {
    const { system } = buildClockResolutionPrompt(baseContext)
    expect(system).toContain('zero effects')
    expect(system).toContain('Never invent')
  })

  it('shows "(none)" for empty known-entity lists rather than an empty line', () => {
    const { user } = buildClockResolutionPrompt({ ...baseContext, knownLocationNames: [], knownFactionNames: [] })
    expect(user).toContain('Known locations you may target: (none)')
    expect(user).toContain('Known factions you may target: (none)')
  })
})

describe('generateClockResolutionEffects', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.mocked(recordAICost).mockClear()
  })

  it('returns null without an API key', async () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    expect(await generateClockResolutionEffects('camp1', baseContext)).toBeNull()
  })

  it('returns null on API error', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    expect(await generateClockResolutionEffects('camp1', baseContext)).toBeNull()
  })

  it('returns null on malformed JSON content', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', mockCompletion('not json'))
    expect(await generateClockResolutionEffects('camp1', baseContext)).toBeNull()
  })

  it('returns an empty array (not null) when the model legitimately finds nothing to apply', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', mockCompletion({ effects: [] }))
    const result = await generateClockResolutionEffects('camp1', baseContext)
    expect(result).toEqual([])
    expect(recordAICost).toHaveBeenCalledTimes(1)
  })

  it('returns validated effects and records cost on success', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal(
      'fetch',
      mockCompletion({ effects: [{ type: 'LOCATION_EFFECT', target_location_name: 'Greenstone', condition_delta: -10, reason: 'fallout' }] })
    )

    const result = await generateClockResolutionEffects('camp1', baseContext)

    expect(result).toEqual([{ type: 'LOCATION_EFFECT', reason: 'fallout', targetLocationName: 'Greenstone', conditionDelta: -10 }])
    expect(recordAICost).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: 'camp1', requestType: 'clock_resolution_effects', success: true })
    )
  })

  it('does not record cost when the response fails validation entirely', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', mockCompletion({ not_effects: [] }))
    await generateClockResolutionEffects('camp1', baseContext)
    expect(recordAICost).not.toHaveBeenCalled()
  })
})
