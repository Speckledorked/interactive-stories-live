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

  it('carries a declared capability prerequisite through, rejecting self-reference (#82)', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', mockCompletion({
      world_seed: 'seed',
      factions: [],
      capability_domains: [
        {
          domain: 'Swordplay',
          capabilities: [
            { name: 'Bladework', description: 'x', tier: 1, is_secret: false },
            { name: 'Riposte', description: 'y', tier: 2, is_secret: false, requires: '  Bladework ' },
            // A node naming itself would be permanently un-unlockable —
            // the one malformed prerequisite worth catching at parse time.
            { name: 'Ouroboros', description: 'z', tier: 2, is_secret: false, requires: 'Ouroboros' },
          ],
        },
      ],
    }))

    const result = await generateWorldFromTemplate('pbta-fantasy', 'Title', '')

    const byName = Object.fromEntries((result?.capabilities || []).map(c => [c.name, c]))
    expect(byName['Riposte'].requires).toBe('Bladework')
    expect(byName['Bladework'].requires).toBeUndefined()
    expect(byName['Ouroboros'].requires).toBeUndefined()
  })

  it('omits statLabels entirely when the response has none', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', mockCompletion({ world_seed: 'seed', factions: [] }))

    const result = await generateWorldFromTemplate('pbta-fantasy', 'Title', '')

    expect(result?.statLabels).toBeUndefined()
  })

  it('parses and normalizes fronts, clamping max_ticks and defaulting an invalid category', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', mockCompletion({
      world_seed: 'seed',
      factions: [{ name: 'The Iron Company', description: 'x', goals: 'y', current_plan: 'z' }],
      fronts: [
        { name: 'The Iron Company Tightens Its Grip', description: 'x', category: 'urgent', max_ticks: 3, consequence: 'bad', source_faction_name: 'The Iron Company' },
        { name: 'Unlinked Threat', description: 'y', category: 'bogus', max_ticks: 999, consequence: 'worse' },
        { name: '', consequence: 'missing a name, dropped' },
        { name: 'Missing consequence, dropped' },
      ],
    }))

    const result = await generateWorldFromTemplate('pbta-fantasy', 'Title', '')

    expect(result?.fronts).toEqual([
      { name: 'The Iron Company Tightens Its Grip', description: 'x', category: 'urgent', maxTicks: 4, consequence: 'bad', sourceFactionName: 'The Iron Company' },
      { name: 'Unlinked Threat', description: 'y', category: 'social', maxTicks: 10, consequence: 'worse', sourceFactionName: undefined },
    ])
  })

  it('defaults to an empty fronts array when the response has none', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', mockCompletion({ world_seed: 'seed', factions: [] }))

    const result = await generateWorldFromTemplate('pbta-fantasy', 'Title', '')

    expect(result?.fronts).toEqual([])
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

  it('still generates factions/capabilities/stat labels when the GM already wrote a world seed', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    const fetchSpy = mockCompletion({
      world_seed: 'echoed back, unused',
      factions: [{ name: 'The Sundered Choir', description: 'x', goals: 'y', current_plan: 'z' }],
      capability_domains: [
        { domain: 'Essence Magic', capabilities: [{ name: 'Essence Sensing', description: 'x', tier: 1, is_secret: false }] },
      ],
    })
    vi.stubGlobal('fetch', fetchSpy)

    const result = await generateWorldFromTemplate(
      null, 'The Sundered Veil', 'desc', 'He Who Fights With Monsters',
      'Helios wakes in an alley with no memory of how he got his essence.'
    )

    expect(result).not.toBeNull()
    expect(result?.factions).toHaveLength(1)
    expect(result?.capabilities).toHaveLength(1)
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as any).body)
    expect(body.messages[1].content).toContain('Helios wakes in an alley')
    expect(body.messages[1].content).toContain('treat it as canon')
  })

  describe('stat_labels grounding in canon lore (#124)', () => {
    // A campaign like "He Who Fights With Monsters" establishes its own
    // named attribute system in the source material. Without this, the
    // prompt only ever told the model to invent new flavor names for the
    // 5 fixed PbtA stats — even when canon already names real ones — so
    // campaigns with lore imported got made-up stats instead of the
    // series' actual ones.
    it('tells the model to reuse real canon-named stats when a lore digest is present', async () => {
      vi.stubEnv('OPENAI_API_KEY', 'test-key')
      const fetchSpy = mockCompletion({ world_seed: 'x', factions: [] })
      vi.stubGlobal('fetch', fetchSpy)

      await generateWorldFromTemplate(
        null, 'Title', 'desc', 'He Who Fights With Monsters', undefined,
        'Attributes in this world are Strength, Speed, Stamina, and Mana.'
      )

      const body = JSON.parse((fetchSpy.mock.calls[0][1] as any).body)
      expect(body.messages[1].content).toMatch(/REUSE those real canon names/)
    })

    it('omits the canon-reuse instruction when there is no lore digest', async () => {
      vi.stubEnv('OPENAI_API_KEY', 'test-key')
      const fetchSpy = mockCompletion({ world_seed: 'x', factions: [] })
      vi.stubGlobal('fetch', fetchSpy)

      await generateWorldFromTemplate('pbta-fantasy', 'Title', 'desc')

      const body = JSON.parse((fetchSpy.mock.calls[0][1] as any).body)
      expect(body.messages[1].content).not.toMatch(/REUSE those real canon names/)
    })
  })
})
