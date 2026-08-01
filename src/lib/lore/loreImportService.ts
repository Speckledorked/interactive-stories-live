// src/lib/lore/loreImportService.ts
// Orchestrates one LoreImportJob to completion: fetch/parse the source
// (pasted text / a single URL / an entire MediaWiki wiki), chunk it, embed
// each chunk, and store it as searchable LoreEntry rows — the same
// chunk-and-embed shape CampaignMemory uses for play history, but for
// static world-bible content.
//
// Pure orchestration lives here; retry/status-transition bookkeeping lives
// in loreQueue.ts (mirrors resolutionQueue.ts's job lifecycle).

import { prisma } from '@/lib/prisma'
import type { LoreImportJob } from '@prisma/client'
import { generateEmbedding, embeddingToPostgresVector } from '@/lib/ai/embeddingService'
import { chunkText, type TextChunk } from './textChunker'
import { extractFromHtml } from './htmlExtractor'
import { detectApiBase, listAllPages, rankPagesByLength, fetchExtracts, fetchPageViaParse, pageTitleFromUrl } from './mediaWikiClient'

// A wiki crawl runs inside a single worker invocation (see the internal
// route's maxDuration) — capped well short of "the whole internet" so one
// job reliably finishes instead of timing out mid-crawl and leaving a job
// stuck RUNNING until stale-recovery resets it (which would re-crawl from
// scratch, not resume). Big wikis get their most-substantial N pages by
// content length (see rankPagesByLength) — listAllPages' own native order
// is alphabetical by title, which would otherwise make the pages actually
// imported an arbitrary function of the alphabet, not of what's actually
// the meat of the wiki's lore.
export const WIKI_MAX_PAGES = 150
// How many candidate titles to consider ranking before selecting the top
// WIKI_MAX_PAGES by length — bigger than WIKI_MAX_PAGES so a large wiki's
// alphabetically-early pages don't win by default just for being listed
// first, but bounded so the extra prop=info ranking calls can't run away
// on an enormous wiki.
const WIKI_RANKING_CANDIDATE_CEILING = 1000
const WIKI_EXTRACT_BATCH_SIZE = 20

/**
 * Fetch, chunk, embed, and store one job's source material. Throws on
 * unrecoverable failure — the caller (loreQueue) handles retry bookkeeping.
 */
export async function runLoreImport(job: LoreImportJob): Promise<void> {
  switch (job.sourceType) {
    case 'PASTE':
      return importPaste(job)
    case 'URL':
      return importUrl(job)
    case 'WIKI':
      return importWiki(job)
    default:
      throw new Error(`Unknown lore source type: ${job.sourceType}`)
  }
}

async function importPaste(job: LoreImportJob): Promise<void> {
  const text = job.rawText || ''
  if (!text.trim()) throw new Error('No text to import')

  await prisma.loreImportJob.update({ where: { id: job.id }, data: { pagesFound: 1 } })

  const chunks = chunkText(text, job.sourceTitle || 'Pasted Lore')
  const stored = await storeLoreChunks(job.campaignId, job.id, chunks)

  await prisma.loreImportJob.update({
    where: { id: job.id },
    data: { pagesDone: 1, entriesCreated: { increment: stored } },
  })
}

async function importUrl(job: LoreImportJob): Promise<void> {
  const url = job.sourceUrl
  if (!url) throw new Error('No URL to import')

  await prisma.loreImportJob.update({ where: { id: job.id }, data: { pagesFound: 1 } })

  const page = await fetchSinglePage(url, job.sourceTitle)
  if (!page.text.trim()) throw new Error('No readable text found at that URL')

  const chunks = chunkText(page.text, job.sourceTitle || page.title)
  const stored = await storeLoreChunks(job.campaignId, job.id, chunks, url)

  await prisma.loreImportJob.update({
    where: { id: job.id },
    data: { pagesDone: 1, entriesCreated: { increment: stored } },
  })
}

/**
 * Fetch one page's readable text for the single-URL import path,
 * preferring the source wiki's own MediaWiki API when the URL points at
 * one. Confirmed live against Fandom: a direct fetch of a wiki page's HTML
 * (e.g. ".../wiki/Category:Characters") gets a flat 403 from Fandom's
 * Cloudflare bot protection regardless of User-Agent — including a full
 * browser User-Agent string — while that same wiki's api.php stays open.
 * A single-page URL pointed at any MediaWiki wiki (Fandom above all —
 * it's the most common host for exactly the fan-lore pages this feature
 * targets) now goes through the API instead of hitting that wall.
 */
async function fetchSinglePage(url: string, sourceTitle?: string | null): Promise<{ title: string; text: string }> {
  const apiBase = await detectApiBase(url)
  const pageTitle = apiBase ? pageTitleFromUrl(url) : null

  if (apiBase && pageTitle) {
    const text = await fetchPageViaParse(apiBase, pageTitle)
    if (text && text.trim()) {
      return { title: sourceTitle || pageTitle, text }
    }
  }

  // Not a MediaWiki site, or the API-based fetch came back empty — fall
  // back to fetching the page's own HTML directly, exactly as before.
  const res = await fetch(url, { headers: { 'User-Agent': 'MythOS-LoreImport/1.0' } })
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`)
  const html = await res.text()
  return extractFromHtml(html, sourceTitle || url)
}

async function importWiki(job: LoreImportJob): Promise<void> {
  const baseUrl = job.sourceUrl
  if (!baseUrl) throw new Error('No wiki URL to import')

  const apiBase = await detectApiBase(baseUrl)
  if (!apiBase) {
    throw new Error('That URL does not look like a MediaWiki-based wiki (no api.php found) — try importing it as a single page instead')
  }

  const candidates = await listAllPages(apiBase, WIKI_RANKING_CANDIDATE_CEILING)
  if (candidates.length === 0) throw new Error('No pages found on that wiki')

  // Rank by real content length so the hard WIKI_MAX_PAGES cap selects the
  // wiki's most substantial pages rather than whatever sorts first
  // alphabetically. Fails open to the unranked (alphabetical) order if
  // ranking itself errors — a worse-ranked-but-successful import beats a
  // failed one.
  let ranked = candidates
  try {
    ranked = await rankPagesByLength(apiBase, candidates)
  } catch (err) {
    console.error('Wiki page length ranking failed — falling back to alphabetical order:', err)
  }
  const pages = ranked.slice(0, WIKI_MAX_PAGES)

  await prisma.loreImportJob.update({ where: { id: job.id }, data: { pagesFound: pages.length } })

  for (let i = 0; i < pages.length; i += WIKI_EXTRACT_BATCH_SIZE) {
    const batch = pages.slice(i, i + WIKI_EXTRACT_BATCH_SIZE)
    const extracts = await fetchExtracts(apiBase, batch.map(p => p.title))

    let batchEntries = 0
    for (const p of batch) {
      const text = extracts.get(p.title)
      if (!text || !text.trim()) continue
      const chunks = chunkText(text, p.title)
      batchEntries += await storeLoreChunks(job.campaignId, job.id, chunks, pageUrl(baseUrl, p.title))
    }

    await prisma.loreImportJob.update({
      where: { id: job.id },
      data: { pagesDone: { increment: batch.length }, entriesCreated: { increment: batchEntries } },
    })
  }
}

function pageUrl(wikiBaseUrl: string, title: string): string {
  try {
    return new URL(`/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`, wikiBaseUrl).toString()
  } catch {
    return wikiBaseUrl
  }
}

/**
 * Embed and insert each chunk as its own LoreEntry row. Uses raw SQL for
 * the vector column (Prisma has no native vector type — see
 * memoryCreation.ts for the same pattern). One chunk failing to embed
 * doesn't abort the rest; it's logged and skipped so a flaky embedding
 * call on page 80 of 150 doesn't lose everything already imported.
 */
async function storeLoreChunks(
  campaignId: string,
  jobId: string,
  chunks: TextChunk[],
  sourceUrl?: string
): Promise<number> {
  let stored = 0
  for (const chunk of chunks) {
    try {
      const embedding = await generateEmbedding(chunk.content)
      const embeddingString = embeddingToPostgresVector(embedding)

      await prisma.$executeRaw`
        INSERT INTO lore_entries (
          id, "campaignId", "jobId", title, "sourceUrl", content, embedding, tags, "createdAt"
        ) VALUES (
          gen_random_uuid(),
          ${campaignId},
          ${jobId},
          ${chunk.title},
          ${sourceUrl ?? null},
          ${chunk.content},
          ${embeddingString}::vector,
          ARRAY[]::text[],
          NOW()
        )
      `
      stored++
    } catch (error) {
      console.error(`Failed to embed/store lore chunk "${chunk.title}":`, error)
    }
  }
  return stored
}
