import { describe, it, expect, vi, afterEach } from 'vitest'
import { moderatePlayerText, parseModerationResponse } from '../moderation'

describe('parseModerationResponse (pure)', () => {
  it('returns clean for an empty/malformed payload', () => {
    expect(parseModerationResponse(undefined)).toEqual({ flagged: false, categories: [] })
    expect(parseModerationResponse({})).toEqual({ flagged: false, categories: [] })
    expect(parseModerationResponse({ results: [] })).toEqual({ flagged: false, categories: [] })
  })

  it('extracts the flagged verdict and only the true categories', () => {
    const result = parseModerationResponse({
      results: [
        {
          flagged: true,
          categories: { violence: true, 'self-harm': false, harassment: true },
        },
      ],
    })
    expect(result.flagged).toBe(true)
    expect(result.categories.sort()).toEqual(['harassment', 'violence'])
  })

  it('returns clean for an unflagged result', () => {
    const result = parseModerationResponse({
      results: [{ flagged: false, categories: { violence: false } }],
    })
    expect(result).toEqual({ flagged: false, categories: [] })
  })
})

describe('moderatePlayerText', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('skips the API entirely without a key or for blank text', async () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    expect(await moderatePlayerText('anything')).toEqual({ flagged: false, categories: [] })

    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    expect(await moderatePlayerText('   ')).toEqual({ flagged: false, categories: [] })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns the parsed verdict from the API', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{ flagged: true, categories: { hate: true } }] }),
    }))
    const result = await moderatePlayerText('some player text')
    expect(result.flagged).toBe(true)
    expect(result.categories).toEqual(['hate'])
  })

  it('fails open when the moderation API errors', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    expect(await moderatePlayerText('some player text')).toEqual({ flagged: false, categories: [] })
  })

  it('fails open when fetch itself throws', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    expect(await moderatePlayerText('some player text')).toEqual({ flagged: false, categories: [] })
  })
})
