// src/lib/lore/__tests__/mediaWikiClient.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { detectApiBase, listAllPages, rankPagesByLength, fetchExtracts, fetchPageViaParse, pageTitleFromUrl } from '../mediaWikiClient'

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

describe('rankPagesByLength', () => {
  it('sorts candidates by real content length, descending, not their input order', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        query: {
          pages: {
            '1': { title: 'Stub Page', length: 40 },
            '2': { title: 'The Real Lore', length: 4000 },
            '3': { title: 'Medium Page', length: 800 },
          },
        },
      }),
    })
    vi.stubGlobal('fetch', fetchSpy)

    const candidates = [
      { pageId: 1, title: 'Stub Page' },
      { pageId: 2, title: 'The Real Lore' },
      { pageId: 3, title: 'Medium Page' },
    ]
    const ranked = await rankPagesByLength('https://example.org/api.php', candidates)
    expect(ranked.map(p => p.title)).toEqual(['The Real Lore', 'Medium Page', 'Stub Page'])
  })

  it('batches length lookups instead of one request per candidate', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ query: { pages: {} } }),
    })
    vi.stubGlobal('fetch', fetchSpy)

    const candidates = Array.from({ length: 45 }, (_, i) => ({ pageId: i, title: `Page ${i}` }))
    await rankPagesByLength('https://example.org/api.php', candidates, 20)
    // 45 candidates at a batch size of 20 → 3 requests (20 + 20 + 5), not 45.
    expect(fetchSpy).toHaveBeenCalledTimes(3)
  })

  it('sorts a candidate whose length lookup failed to the back rather than dropping it', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        query: {
          pages: {
            '1': { title: 'Has Length', length: 500 },
            // 'No Length' is simply absent from the response.
          },
        },
      }),
    })
    vi.stubGlobal('fetch', fetchSpy)

    const candidates = [
      { pageId: 1, title: 'No Length' },
      { pageId: 2, title: 'Has Length' },
    ]
    const ranked = await rankPagesByLength('https://example.org/api.php', candidates)
    expect(ranked.map(p => p.title)).toEqual(['Has Length', 'No Length'])
  })

  it('does not throw when the length-lookup call itself fails — length lookups just come back empty', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    const candidates = [{ pageId: 1, title: 'A' }, { pageId: 2, title: 'B' }]
    const ranked = await rankPagesByLength('https://example.org/api.php', candidates)
    expect(ranked).toHaveLength(2)
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

  it('falls back to action=parse for a wiki without the TextExtracts extension (confirmed live against Fandom)', async () => {
    // Real shape Fandom's api.php actually returns for prop=extracts: a
    // warning that the parameter is unrecognized, and pages with no
    // extract field at all -- not an error, just silently no content.
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          warnings: { main: { '*': 'Unrecognized parameter: explaintext.' } },
          query: { pages: { '1': { pageid: 1, title: 'Hogwarts' } } },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          parse: { title: 'Hogwarts', text: { '*': '<div id="mw-content-text"><h1>Hogwarts</h1><p>A school of magic.</p></div>' } },
        }),
      })
    vi.stubGlobal('fetch', fetchSpy)

    const result = await fetchExtracts('https://harrypotter.fandom.com/api.php', ['Hogwarts'])
    expect(result.get('Hogwarts')).toContain('A school of magic.')
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('does not fall back for a title the batched call already returned content for', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ query: { pages: { '1': { title: 'Essence Magic', extract: 'Real extract text.' } } } }),
    })
    vi.stubGlobal('fetch', fetchSpy)

    const result = await fetchExtracts('https://example.org/api.php', ['Essence Magic'])
    expect(result.get('Essence Magic')).toBe('Real extract text.')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('does not throw when the batched extracts call itself fails', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ parse: { text: { '*': '<h1>T</h1><p>Fallback text.</p>' } } }),
      })
    vi.stubGlobal('fetch', fetchSpy)

    const result = await fetchExtracts('https://example.org/api.php', ['T'])
    expect(result.get('T')).toContain('Fallback text.')
  })
})

describe('pageTitleFromUrl', () => {
  it('extracts and decodes a title from a canonical wiki URL', () => {
    expect(pageTitleFromUrl('https://licanius.fandom.com/wiki/Category:Characters')).toBe('Category:Characters')
    expect(pageTitleFromUrl('https://example.fandom.com/wiki/The_Unbound_Empire')).toBe('The Unbound Empire')
  })

  it('URL-decodes percent-encoded characters', () => {
    expect(pageTitleFromUrl('https://example.fandom.com/wiki/Caf%C3%A9_Society')).toBe('Café Society')
  })

  it('returns null for a URL with no /wiki/ path segment', () => {
    expect(pageTitleFromUrl('https://example.fandom.com/')).toBeNull()
    expect(pageTitleFromUrl('https://example.com/blog/post')).toBeNull()
  })

  it('returns null for an invalid URL', () => {
    expect(pageTitleFromUrl('not a url')).toBeNull()
  })
})

describe('fetchPageViaParse', () => {
  it('renders the page and extracts plain text from it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        parse: { title: 'Hogwarts', text: { '*': '<div id="mw-content-text"><h1>Hogwarts</h1><p>A school of magic.</p></div>' } },
      }),
    }))

    const text = await fetchPageViaParse('https://harrypotter.fandom.com/api.php', 'Hogwarts')
    expect(text).toContain('A school of magic.')
  })

  it('returns null when the API call fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    expect(await fetchPageViaParse('https://example.org/api.php', 'Missing Page')).toBeNull()
  })

  it('returns null when the response has no rendered text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ parse: {} }) }))
    expect(await fetchPageViaParse('https://example.org/api.php', 'Empty')).toBeNull()
  })

  it('returns null when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    expect(await fetchPageViaParse('https://example.org/api.php', 'X')).toBeNull()
  })
})
