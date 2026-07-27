// src/lib/lore/mediaWikiClient.ts
// Talks to the MediaWiki Action API — the structured API that Fandom,
// wiki.gg, Wikipedia, and most other wiki hosts expose. Used for the "give
// me a wiki base URL and pull in the whole thing" lore import path.
//
// Deliberately NOT a generic web crawler: if a site isn't running
// MediaWiki, detectApiBase() returns null and the caller falls back to
// treating the URL as a single page instead.

import { extractFromHtml } from './htmlExtractor'

export interface WikiPageSummary {
  pageId: number
  title: string
}

const CANDIDATE_API_PATHS = ['/api.php', '/w/api.php']

/**
 * Given any URL pointing somewhere on a wiki (its main page, an article, or
 * just its domain root), find that wiki's MediaWiki Action API endpoint.
 * Returns null if the site doesn't appear to run MediaWiki.
 */
export async function detectApiBase(inputUrl: string): Promise<string | null> {
  let origin: string
  try {
    origin = new URL(inputUrl).origin
  } catch {
    return null
  }

  for (const path of CANDIDATE_API_PATHS) {
    const candidate = `${origin}${path}`
    try {
      const res = await fetch(`${candidate}?action=query&meta=siteinfo&format=json`, {
        headers: { 'User-Agent': 'MythOS-LoreImport/1.0' },
      })
      if (!res.ok) continue
      const data = await res.json()
      if (data?.query?.general?.sitename) {
        return candidate
      }
    } catch {
      continue
    }
  }
  return null
}

/**
 * List every content page on the wiki, paginating through `apcontinue`
 * until exhausted or `maxPages` is reached. Namespace 0 = main/article
 * namespace only (skips Talk:, User:, Category:, File:, etc.).
 */
export async function listAllPages(apiBase: string, maxPages = 500): Promise<WikiPageSummary[]> {
  const pages: WikiPageSummary[] = []
  let apcontinue: string | undefined

  while (pages.length < maxPages) {
    const params = new URLSearchParams({
      action: 'query',
      list: 'allpages',
      aplimit: '500',
      apnamespace: '0',
      format: 'json',
    })
    if (apcontinue) params.set('apcontinue', apcontinue)

    const res = await fetch(`${apiBase}?${params.toString()}`, {
      headers: { 'User-Agent': 'MythOS-LoreImport/1.0' },
    })
    if (!res.ok) break
    const data = await res.json()

    const batch = data?.query?.allpages
    if (!Array.isArray(batch) || batch.length === 0) break
    for (const p of batch) {
      if (p?.pageid != null && p?.title) {
        pages.push({ pageId: p.pageid, title: p.title })
      }
    }

    apcontinue = data?.continue?.apcontinue
    if (!apcontinue) break
  }

  return pages.slice(0, maxPages)
}

/**
 * Fetch the plain-text extract (rendered article text, no wikitext markup)
 * for one or more page titles in a single request. MediaWiki caps
 * multi-title extract requests, so callers should batch in groups of ~20.
 *
 * `prop=extracts` needs the TextExtracts extension, which is NOT a given —
 * confirmed empirically against Fandom (harrypotter.fandom.com,
 * leagueoflegends.fandom.com, and others all reject it as an unrecognized
 * parameter, while Wikipedia supports it fine). Since Fandom is the single
 * most likely wiki host a MythOS user actually points this at, any title
 * this call comes back empty for is retried individually through
 * fetchPageViaParse below — action=parse is a core API action every
 * MediaWiki install has, unlike TextExtracts. Without this fallback, a
 * whole-wiki import against a TextExtracts-less wiki silently succeeds
 * with pagesDone === pagesFound and zero entries created.
 */
export async function fetchExtracts(apiBase: string, titles: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  if (titles.length === 0) return result

  const params = new URLSearchParams({
    action: 'query',
    prop: 'extracts',
    explaintext: '1',
    titles: titles.join('|'),
    format: 'json',
  })

  try {
    const res = await fetch(`${apiBase}?${params.toString()}`, {
      headers: { 'User-Agent': 'MythOS-LoreImport/1.0' },
    })
    if (res.ok) {
      const data = await res.json()
      const pages = data?.query?.pages
      if (pages && typeof pages === 'object') {
        for (const page of Object.values(pages) as any[]) {
          if (page?.title && typeof page.extract === 'string' && page.extract.trim()) {
            result.set(page.title, page.extract)
          }
        }
      }
    }
  } catch {
    // Falls through to the per-title fallback below for every title.
  }

  const missing = titles.filter(title => !result.has(title))
  if (missing.length > 0) {
    const fallbacks = await Promise.all(missing.map(title => fetchPageViaParse(apiBase, title)))
    fallbacks.forEach((text, i) => {
      if (text && text.trim()) result.set(missing[i], text)
    })
  }

  return result
}

/**
 * Extract a MediaWiki page title from a canonical article URL (the
 * ".../wiki/Page_Title" shape every MediaWiki site uses, Fandom included).
 * Returns null for a URL that isn't an article link (e.g. just the wiki's
 * root, or a query-string-based URL some older installs use).
 */
export function pageTitleFromUrl(url: string): string | null {
  try {
    const { pathname } = new URL(url)
    const match = pathname.match(/\/wiki\/(.+)$/)
    if (!match) return null
    const decoded = decodeURIComponent(match[1]).replace(/_/g, ' ')
    return decoded.trim() || null
  } catch {
    return null
  }
}

/**
 * Render one page via action=parse and pull its plain text out of the
 * rendered HTML with the same cheerio-based extractor the single-URL
 * importer uses for arbitrary web pages. The universal fallback for a wiki
 * without TextExtracts (see fetchExtracts above) — every MediaWiki install
 * supports action=parse, since it's what the wiki's own page-view feature
 * is built on.
 */
export async function fetchPageViaParse(apiBase: string, title: string): Promise<string | null> {
  const params = new URLSearchParams({ action: 'parse', page: title, prop: 'text', format: 'json' })
  try {
    const res = await fetch(`${apiBase}?${params.toString()}`, {
      headers: { 'User-Agent': 'MythOS-LoreImport/1.0' },
    })
    if (!res.ok) return null
    const data = await res.json()
    const html = data?.parse?.text?.['*']
    if (typeof html !== 'string' || !html.trim()) return null
    const { text } = extractFromHtml(html, title)
    return text
  } catch {
    return null
  }
}
