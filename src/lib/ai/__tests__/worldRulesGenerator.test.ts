// src/lib/ai/__tests__/worldRulesGenerator.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { generateWorldRules, generatedRulesToWorldRules } from '../worldRulesGenerator'

function mockCompletion(content: object) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(content) } }] }),
  })
}

describe('generateWorldRules', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('returns null without an API key', async () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    expect(await generateWorldRules('T', '', 'U')).toBeNull()
  })

  it('returns null on API error', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    expect(await generateWorldRules('T', '', 'U')).toBeNull()
  })

  it('returns null on malformed JSON content', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'not json' } }] }),
    }))
    expect(await generateWorldRules('T', '', 'U')).toBeNull()
  })

  it('returns null when the response has no rules array at all', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', mockCompletion({ nope: true }))
    expect(await generateWorldRules('T', '', 'U')).toBeNull()
  })

  it('parses a well-formed rule for a known family', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', mockCompletion({
      rules: [
        { family_key: 'faction.leaderOptional', applies: true, confidence: 0.85, rationale: 'A hive-mind collective has no single leader.' },
      ],
    }))

    const result = await generateWorldRules('The Swarm', 'desc', 'Bio-Horror')
    expect(result).toEqual([
      { familyKey: 'faction.leaderOptional', applies: true, confidence: 0.85, rationale: 'A hive-mind collective has no single leader.' },
    ])
  })

  it('drops an entry with an unknown family_key — the catalogue is closed even at generation time', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', mockCompletion({
      rules: [
        { family_key: 'faction.leaderOptional', applies: false, confidence: 0.9, rationale: 'x' },
        { family_key: 'npc.canTimeTravel', applies: true, confidence: 0.9, rationale: 'hallucinated' },
      ],
    }))

    const result = await generateWorldRules('T', '', 'U')
    expect(result).toHaveLength(1)
    expect(result?.[0].familyKey).toBe('faction.leaderOptional')
  })

  it('clamps an out-of-range confidence into 0-1', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', mockCompletion({
      rules: [{ family_key: 'faction.leaderOptional', applies: true, confidence: 5, rationale: 'x' }],
    }))
    const result = await generateWorldRules('T', '', 'U')
    expect(result?.[0].confidence).toBe(1)
  })

  it('drops an entry missing a boolean applies or a numeric confidence', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', mockCompletion({
      rules: [
        { family_key: 'faction.leaderOptional', confidence: 0.9, rationale: 'x' },
        { family_key: 'faction.leaderOptional', applies: true, confidence: 'high', rationale: 'x' },
      ],
    }))
    const result = await generateWorldRules('T', '', 'U')
    expect(result).toHaveLength(0)
  })
})

describe('generatedRulesToWorldRules', () => {
  it('stamps every rule with the given sinceTurn', () => {
    const worldRules = generatedRulesToWorldRules(
      [{ familyKey: 'faction.leaderOptional', applies: true, confidence: 0.8, rationale: 'x' }],
      42
    )
    expect(worldRules.rules).toEqual([
      { familyKey: 'faction.leaderOptional', applies: true, confidence: 0.8, rationale: 'x', sinceTurn: 42 },
    ])
  })
})
