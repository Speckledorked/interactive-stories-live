// src/lib/ai/__tests__/worldExtras.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { generateWorldExtras } from '../worldExtras'

function mockCompletion(content: object) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(content) } }] }),
  })
}

const factions = [{ name: 'The Adventure Society', description: 'x' }]
const capabilities = [
  { domain: 'Essence Magic', name: 'Essence Sensing', description: '', tier: 1, isSecret: false },
  { domain: 'Forbidden Arts', name: 'Blood Runes', description: '', tier: 3, isSecret: true },
]

describe('generateWorldExtras', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('returns null without an API key', async () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    expect(await generateWorldExtras('T', '', 'U', factions, capabilities)).toBeNull()
  })

  it('parses archetypes, dropping illegal stat arrays but keeping the card', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', mockCompletion({
      archetypes: [
        {
          name: 'Outworlder',
          description: 'A stranger to this world.',
          origin_familiarity: 'OUTSIDER',
          suggested_stats: { cool: 1, hard: 0, hot: -1, sharp: 2, weird: 0 }, // sums to +2, legal
          backstory_prompts: ['Where were you when you crossed over?'],
          glimpse_capability_keys: ['essence-sensing', 'blood-runes', 'not-a-real-key'],
        },
        {
          name: 'Overstuffed',
          description: 'Illegal stats.',
          origin_familiarity: 'NATIVE',
          suggested_stats: { cool: 3, hard: 3, hot: 3, sharp: 3, weird: 3 }, // illegal
        },
      ],
      corruption_theme: null,
    }))

    const result = await generateWorldExtras('T', '', 'U', factions, capabilities)

    expect(result?.archetypes).toHaveLength(2)
    expect(result?.archetypes[0].suggestedStats).toEqual({ cool: 1, hard: 0, hot: -1, sharp: 2, weird: 0 })
    // Secret and unknown capability keys are filtered; the valid one survives.
    expect(result?.archetypes[0].glimpseCapabilityKeys).toEqual(['essence-sensing'])
    // Illegal stat array → card kept, stats dropped.
    expect(result?.archetypes[1].suggestedStats).toBeNull()
  })

  it('drops a faction tie pointing at a faction that does not exist', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', mockCompletion({
      archetypes: [
        {
          name: 'Debtor', description: 'x', origin_familiarity: 'NATIVE',
          starting_tie: { kind: 'debt_owed_by_character', counterparty_type: 'faction', counterparty_name: 'Invented Guild', description: 'owes them' },
        },
        {
          name: 'Initiate', description: 'x', origin_familiarity: 'NATIVE',
          starting_tie: { kind: 'faction_standing', counterparty_type: 'faction', counterparty_name: 'The Adventure Society', description: 'member in good standing', standing_value: 1 },
        },
      ],
      corruption_theme: null,
    }))

    const result = await generateWorldExtras('T', '', 'U', factions, capabilities)
    expect(result?.archetypes[0].startingTie).toBeNull()
    expect(result?.archetypes[1].startingTie).toMatchObject({
      kind: 'faction_standing',
      counterparty_name: 'The Adventure Society',
      standing_value: 1,
    })
  })

  it('passes a corruption theme through and respects null (universe has none)', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', mockCompletion({
      archetypes: [],
      corruption_theme: {
        name: 'The Hollowing',
        description: 'Borrowed power that hollows the borrower.',
        stages: ['s1', 's2', 's3', 's4', 's5'],
        bargain_guidance: 'Offer at moments of desperation.',
      },
    }))

    const withTheme = await generateWorldExtras('T', '', 'U', factions, capabilities)
    expect(withTheme?.corruptionTheme?.name).toBe('The Hollowing')
    expect(withTheme?.corruptionTheme?.stages).toHaveLength(5)

    vi.stubGlobal('fetch', mockCompletion({ archetypes: [], corruption_theme: null }))
    const withoutTheme = await generateWorldExtras('T', '', 'U', factions, capabilities)
    expect(withoutTheme?.corruptionTheme).toBeNull()
  })

  it('returns null when the API call fails', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    expect(await generateWorldExtras('T', '', 'U', factions, capabilities)).toBeNull()
  })

  it('parses and normalizes npcs, clamping importance and dropping unnamed entries', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', mockCompletion({
      archetypes: [],
      corruption_theme: null,
      npcs: [
        { name: 'Lord Kessler', description: 'x', pronouns: 'he/him', importance: 9, goals: 'rule', faction_name: 'The Adventure Society' },
        { name: 'A Nobody', description: 'y', importance: 0 },
        { description: 'missing a name, dropped' },
      ],
    }))

    const result = await generateWorldExtras('T', '', 'U', factions, capabilities)

    expect(result?.npcs).toEqual([
      { name: 'Lord Kessler', description: 'x', pronouns: 'he/him', importance: 5, goals: 'rule', factionName: 'The Adventure Society' },
      { name: 'A Nobody', description: 'y', pronouns: undefined, importance: 2, goals: undefined, factionName: undefined },
    ])
  })

  it('defaults to an empty npcs array when the response has none', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', mockCompletion({ archetypes: [], corruption_theme: null }))
    const result = await generateWorldExtras('T', '', 'U', factions, capabilities)
    expect(result?.npcs).toEqual([])
  })

  it('parses and normalizes locations, dropping unnamed entries', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', mockCompletion({
      archetypes: [],
      corruption_theme: null,
      locations: [
        { name: 'Ashveil Keep', description: 'x', location_type: 'stronghold', owner_faction_name: 'The Adventure Society' },
        { description: 'missing a name, dropped' },
      ],
    }))

    const result = await generateWorldExtras('T', '', 'U', factions, capabilities)

    expect(result?.locations).toEqual([
      { name: 'Ashveil Keep', description: 'x', locationType: 'stronghold', ownerFactionName: 'The Adventure Society' },
    ])
  })

  it('defaults to an empty locations array when the response has none', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', mockCompletion({ archetypes: [], corruption_theme: null }))
    const result = await generateWorldExtras('T', '', 'U', factions, capabilities)
    expect(result?.locations).toEqual([])
  })
})
