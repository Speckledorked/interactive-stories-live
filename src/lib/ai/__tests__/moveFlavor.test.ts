// src/lib/ai/__tests__/moveFlavor.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { generateMoveFlavor } from '../moveFlavor'
import { BASIC_MOVES } from '@/lib/pbta-moves'

function mockCompletion(content: object) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(content) } }] }),
  })
}

function fullFlavorResponse() {
  return {
    moves: BASIC_MOVES.map(m => ({
      base_move_key: m.key,
      name: `Flavored ${m.name}`,
      trigger: `Flavored trigger for ${m.key}`,
      description: 'Flavored description.',
      outcomes: {
        strong_hit: 'Flavored strong hit.',
        weak_hit: 'Flavored weak hit.',
        miss: 'Flavored miss.',
      },
    })),
  }
}

describe('generateMoveFlavor', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('returns null without an API key', async () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    expect(await generateMoveFlavor('T', '', 'U')).toBeNull()
  })

  it('returns null on API error', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    expect(await generateMoveFlavor('T', '', 'U')).toBeNull()
  })

  it('parses a full response into one entry per canonical move', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', mockCompletion(fullFlavorResponse()))

    const result = await generateMoveFlavor('The Iron Vigil', 'desc', 'Grimdark Fantasy')
    expect(result).toHaveLength(BASIC_MOVES.length)
    const byKey = new Map(result!.map(m => [m.baseMoveKey, m]))
    for (const move of BASIC_MOVES) {
      const flavor = byKey.get(move.key)
      expect(flavor).toBeDefined()
      expect(flavor!.name).toBe(`Flavored ${move.name}`)
      expect(flavor!.outcomes.strongHit).toBe('Flavored strong hit.')
    }
  })

  it('drops entries with an unrecognized base_move_key', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', mockCompletion({
      moves: [
        {
          base_move_key: 'not_a_real_key',
          name: 'Bogus', trigger: 't', description: 'd',
          outcomes: { strong_hit: 's', weak_hit: 'w', miss: 'm' },
        },
        {
          base_move_key: 'act_under_fire',
          name: 'Face the Storm', trigger: 't', description: 'd',
          outcomes: { strong_hit: 's', weak_hit: 'w', miss: 'm' },
        },
      ],
    }))

    const result = await generateMoveFlavor('T', '', 'U')
    expect(result).toHaveLength(1)
    expect(result![0].baseMoveKey).toBe('act_under_fire')
  })

  it('dedupes a repeated base_move_key, keeping the first', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', mockCompletion({
      moves: [
        { base_move_key: 'act_under_fire', name: 'First', trigger: 't', description: 'd', outcomes: { strong_hit: 's', weak_hit: 'w', miss: 'm' } },
        { base_move_key: 'act_under_fire', name: 'Second', trigger: 't', description: 'd', outcomes: { strong_hit: 's', weak_hit: 'w', miss: 'm' } },
      ],
    }))

    const result = await generateMoveFlavor('T', '', 'U')
    expect(result).toHaveLength(1)
    expect(result![0].name).toBe('First')
  })

  it('drops an entry missing required fields', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', mockCompletion({
      moves: [
        { base_move_key: 'go_aggro', name: '', trigger: 't', description: 'd', outcomes: { strong_hit: 's', weak_hit: 'w', miss: 'm' } },
      ],
    }))

    const result = await generateMoveFlavor('T', '', 'U')
    expect(result).toEqual([])
  })

  it('returns null when moves is not an array', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', mockCompletion({ moves: 'nope' }))
    expect(await generateMoveFlavor('T', '', 'U')).toBeNull()
  })
})
