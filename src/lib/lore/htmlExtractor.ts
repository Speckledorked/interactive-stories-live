// src/lib/lore/htmlExtractor.ts
// Turns a raw HTML page into plain, readable text for chunking/embedding.
// Strips chrome (nav, scripts, styles, footers) that would otherwise
// pollute the embedding with boilerplate instead of lore.

import * as cheerio from 'cheerio'

export interface ExtractedPage {
  title: string
  text: string
}

const NOISE_SELECTORS = [
  'script', 'style', 'noscript', 'nav', 'header', 'footer',
  'iframe', 'svg', 'form', 'button',
  // Common wiki/site chrome that isn't article content.
  '.navbox', '.infobox', '.toc', '#toc', '.mw-editsection',
  '.reference', '.reflist', '.catlinks', '.printfooter',
  '.sidebar', '.ad', '.advertisement', '[role="navigation"]',
]

/**
 * Extract a readable title + body text from a raw HTML document. Pure
 * string-in/string-out — no network — so both the single-URL importer and
 * the MediaWiki crawler (which fetches raw page HTML for non-API fallback)
 * can share it.
 */
export function extractFromHtml(html: string, fallbackTitle = 'Untitled Page'): ExtractedPage {
  const $ = cheerio.load(html)

  $(NOISE_SELECTORS.join(', ')).remove()

  const title = $('h1').first().text().trim()
    || $('title').first().text().trim()
    || fallbackTitle

  // Prefer a wiki/article's main content container when present; fall back
  // to <body> for arbitrary pages.
  const root = $('#mw-content-text').length
    ? $('#mw-content-text')
    : ($('article').length ? $('article') : $('body'))

  const text = normalizeWhitespace(root.text())

  return { title, text }
}

function normalizeWhitespace(raw: string): string {
  return raw
    .split('\n')
    .map(line => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
