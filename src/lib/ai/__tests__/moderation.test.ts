import { describe, it, expect, vi, afterEach } from 'vitest'
import { moderatePlayerText, parseModerationResponse, applyModerationLevel } from '../moderation'

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

describe('applyModerationLevel (pure)', () => {
  it('drops plain violence under standard, leaving other categories intact', () => {
    const result = applyModerationLevel({ flagged: true, categories: ['violence', 'hate'] }, 'standard')
    expect(result).toEqual({ flagged: true, categories: ['hate'] })
  })

  it('clears the flag entirely under standard when violence was the only category', () => {
    const result = applyModerationLevel({ flagged: true, categories: ['violence'] }, 'standard')
    expect(result).toEqual({ flagged: false, categories: [] })
  })

  it('leaves severe categories blocked under standard', () => {
    const result = applyModerationLevel({ flagged: true, categories: ['sexual/minors'] }, 'standard')
    expect(result).toEqual({ flagged: true, categories: ['sexual/minors'] })
  })

  it('does not exempt anything under strict', () => {
    const result = applyModerationLevel({ flagged: true, categories: ['violence'] }, 'strict')
    expect(result).toEqual({ flagged: true, categories: ['violence'] })
  })

  it('passes through a clean result unchanged', () => {
    expect(applyModerationLevel({ flagged: false, categories: [] }, 'standard')).toEqual({ flagged: false, categories: [] })
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

  it('does not block ordinary violent RPG action text by default', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{ flagged: true, categories: { violence: true } }] }),
    }))
    expect(await moderatePlayerText('I swing my sword at the guard')).toEqual({ flagged: false, categories: [] })
  })

  it('blocks plain violence when the campaign opts into strict moderation', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{ flagged: true, categories: { violence: true } }] }),
    }))
    const result = await moderatePlayerText('I swing my sword at the guard', 'strict')
    expect(result.flagged).toBe(true)
    expect(result.categories).toEqual(['violence'])
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
