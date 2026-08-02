// src/lib/ai/__tests__/worldGraphGenerator.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { generateWorldGraph } from '../worldGraphGenerator'

function mockCompletion(content: object) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(content) } }] }),
  })
}

const locations = [
  { name: 'Ashford', description: 'A coastal town.' },
  { name: 'Briar Keep', description: 'A fortress in the hills.' },
]

describe('generateWorldGraph', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('returns null without an API key', async () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    expect(await generateWorldGraph('T', '', 'U', locations)).toBeNull()
  })

  it('returns null with fewer than 2 locations, without even calling the API', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await generateWorldGraph('T', '', 'U', [locations[0]])).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns null on API error', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    expect(await generateWorldGraph('T', '', 'U', locations)).toBeNull()
  })

  it('returns null on malformed JSON content', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'not json' } }] }),
    }))
    expect(await generateWorldGraph('T', '', 'U', locations)).toBeNull()
  })

  it('returns null when the response has no edges array at all', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', mockCompletion({ nope: true }))
    expect(await generateWorldGraph('T', '', 'U', locations)).toBeNull()
  })

  it('returns null when every edge is dropped, leaving an empty result', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', mockCompletion({ edges: [{ location_a: 'Nowhere', location_b: 'Nowhere Else', distance: 1 }] }))
    expect(await generateWorldGraph('T', '', 'U', locations)).toBeNull()
  })

  it('parses a well-formed edge between two known locations', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', mockCompletion({
      edges: [{ location_a: 'Ashford', location_b: 'Briar Keep', distance: 3 }],
    }))
    const result = await generateWorldGraph('T', '', 'U', locations)
    expect(result).toEqual([{ locationAName: 'Ashford', locationBName: 'Briar Keep', distance: 3 }])
  })

  it('drops an edge naming a location outside the real, campaign-supplied list — never invents a place', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', mockCompletion({
      edges: [
        { location_a: 'Ashford', location_b: 'Briar Keep', distance: 2 },
        { location_a: 'Ashford', location_b: 'Hallucinated City', distance: 1 },
      ],
    }))
    const result = await generateWorldGraph('T', '', 'U', locations)
    expect(result).toEqual([{ locationAName: 'Ashford', locationBName: 'Briar Keep', distance: 2 }])
  })

  it('drops a self-loop edge (a location adjacent to itself)', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', mockCompletion({
      edges: [{ location_a: 'Ashford', location_b: 'Ashford', distance: 1 }],
    }))
    expect(await generateWorldGraph('T', '', 'U', locations)).toBeNull()
  })

  it('deduplicates the same pair given in either order', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', mockCompletion({
      edges: [
        { location_a: 'Ashford', location_b: 'Briar Keep', distance: 2 },
        { location_a: 'Briar Keep', location_b: 'Ashford', distance: 5 },
      ],
    }))
    const result = await generateWorldGraph('T', '', 'U', locations)
    expect(result).toHaveLength(1)
  })

  it('clamps an out-of-range distance into 1-10', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', mockCompletion({
      edges: [{ location_a: 'Ashford', location_b: 'Briar Keep', distance: 999 }],
    }))
    const result = await generateWorldGraph('T', '', 'U', locations)
    expect(result?.[0].distance).toBe(10)
  })

  it('drops an edge with a non-finite distance', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', mockCompletion({
      edges: [{ location_a: 'Ashford', location_b: 'Briar Keep', distance: 'far' }],
    }))
    expect(await generateWorldGraph('T', '', 'U', locations)).toBeNull()
  })
})
