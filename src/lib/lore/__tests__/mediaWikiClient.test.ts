// src/lib/lore/__tests__/mediaWikiClient.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { detectApiBase, listAllPages, fetchExtracts } from '../mediaWikiClient'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('detectApiBase', () => {
  it('returns the api.php endpoint when siteinfo responds with a sitename', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ query: { general: { sitename: 'Harry Potter Wiki' } } }),
    })
    vi.stubGlobal('fetch', fetchSpy)

    const result = await detectApiBase('https://harrypotter.fandom.com/wiki/Main_Page')
    expect(result).toBe('https://harrypotter.fandom.com/api.php')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('falls back to /w/api.php when /api.php fails', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ query: { general: { sitename: 'Some Wiki' } } }),
      })
    vi.stubGlobal('fetch', fetchSpy)

    const result = await detectApiBase('https://example.org/wiki/Foo')
    expect(result).toBe('https://example.org/w/api.php')
  })

  it('returns null for a non-MediaWiki site', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    const result = await detectApiBase('https://example.com')
    expect(result).toBeNull()
  })

  it('returns null for an invalid URL', async () => {
    vi.stubGlobal('fetch', vi.fn())
    expect(await detectApiBase('not a url')).toBeNull()
  })
})

describe('listAllPages', () => {
  it('paginates via apcontinue until exhausted', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          query: { allpages: [{ pageid: 1, title: 'Essence Magic' }] },
          continue: { apcontinue: 'Faction' },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          query: { allpages: [{ pageid: 2, title: 'Faction: The Unbound' }] },
        }),
      })
    vi.stubGlobal('fetch', fetchSpy)

    const result = await listAllPages('https://example.org/api.php')
    expect(result).toEqual([
      { pageId: 1, title: 'Essence Magic' },
      { pageId: 2, title: 'Faction: The Unbound' },
    ])
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('stops at maxPages', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        query: { allpages: [{ pageid: 1, title: 'A' }, { pageid: 2, title: 'B' }] },
        continue: { apcontinue: 'next' },
      }),
    })
    vi.stubGlobal('fetch', fetchSpy)

    const result = await listAllPages('https://example.org/api.php', 1)
    expect(result).toHaveLength(1)
  })
})

describe('fetchExtracts', () => {
  it('returns a title->text map, skipping empty extracts', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        query: {
          pages: {
            '1': { title: 'Essence Magic', extract: 'Magic drawn from the world essence.' },
            '2': { title: 'Empty Page', extract: '' },
          },
        },
      }),
    })
    vi.stubGlobal('fetch', fetchSpy)

    const result = await fetchExtracts('https://example.org/api.php', ['Essence Magic', 'Empty Page'])
    expect(result.get('Essence Magic')).toBe('Magic drawn from the world essence.')
    expect(result.has('Empty Page')).toBe(false)
  })

  it('returns an empty map for an empty titles list without calling fetch', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const result = await fetchExtracts('https://example.org/api.php', [])
    expect(result.size).toBe(0)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
