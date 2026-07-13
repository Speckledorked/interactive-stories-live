// src/lib/ai/__tests__/worldGenerator.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { generateWorldFromTemplate } from '../worldGenerator'

function mockCompletion(content: object) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(content) } }] }),
  })
}

describe('generateWorldFromTemplate', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('returns null without an API key', async () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    expect(await generateWorldFromTemplate('pbta-fantasy', 'Title', '')).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('works for a custom (non-template) universe, using the free-text universe as the genre hint', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    const fetchSpy = mockCompletion({
      world_seed: 'A specific opening situation.',
      factions: [{ name: 'The Unbound', description: 'x', goals: 'y', current_plan: 'z' }],
    })
    vi.stubGlobal('fetch', fetchSpy)

    const result = await generateWorldFromTemplate(null, 'My Campaign', 'desc', 'He Who Fights With Monsters')

    expect(result).not.toBeNull()
    expect(result?.worldSeed).toBe('A specific opening situation.')
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as any).body)
    expect(body.messages[1].content).toContain('Genre: He Who Fights With Monsters')
  })

  it('parses capability_domains and stat_labels when present', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', mockCompletion({
      world_seed: 'seed',
      factions: [],
      capability_domains: [
        { domain: 'Essence Magic', capabilities: [{ name: 'Essence Sensing', description: 'x', tier: 1, is_secret: false }] },
      ],
      stat_labels: {
        cool: { label: 'Composure', description: 'keeping calm' },
        hard: { label: 'Force', description: 'brute strength' },
        hot: { label: 'Presence', description: 'charisma' },
        sharp: { label: 'Insight', description: 'perception' },
        weird: { label: 'Essence Sense', description: 'feel for essence' },
      },
    }))

    const result = await generateWorldFromTemplate('pbta-fantasy', 'Title', '')

    expect(result?.capabilities).toEqual([
      { domain: 'Essence Magic', name: 'Essence Sensing', description: 'x', tier: 1, isSecret: false },
    ])
    expect(result?.statLabels?.weird).toEqual({ label: 'Essence Sense', description: 'feel for essence' })
    expect(result?.statLabels?.cool.label).toBe('Composure')
  })

  it('omits statLabels entirely when the response has none', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', mockCompletion({ world_seed: 'seed', factions: [] }))

    const result = await generateWorldFromTemplate('pbta-fantasy', 'Title', '')

    expect(result?.statLabels).toBeUndefined()
  })

  it('returns null when the response is missing required fields', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', mockCompletion({ factions: [] }))
    expect(await generateWorldFromTemplate('pbta-fantasy', 'Title', '')).toBeNull()
  })

  it('returns null when the API call fails', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    expect(await generateWorldFromTemplate('pbta-fantasy', 'Title', '')).toBeNull()
  })
})
