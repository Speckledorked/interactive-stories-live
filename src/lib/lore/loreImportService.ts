// src/lib/lore/loreImportService.ts
// Orchestrates one LoreImportJob to completion: fetch/parse the source
// (pasted text / a single URL / an entire MediaWiki wiki), chunk it, embed
// each chunk, and store it as searchable LoreEntry rows — the same
// chunk-and-embed shape CampaignMemory uses for play history, but for
// static world-bible content.
//
// Pure orchestration lives here; retry/status-transition bookkeeping lives
// in loreQueue.ts (mirrors resolutionQueue.ts's job lifecycle).

import { createHash } from 'crypto'
import { prisma } from '@/lib/prisma'
import type { LoreImportJob } from '@prisma/client'
import { embedBatchWithCostTracking, embedWithCostTracking } from '@/lib/ai/embeddingService'
import { chunkText, type TextChunk } from './textChunker'
import { extractFromHtml } from './htmlExtractor'
import { detectApiBase, listAllPages, rankPagesByLength, fetchCategoryMembers, fetchExtracts, fetchPageViaParse, pageTitleFromUrl } from './mediaWikiClient'

// A wiki crawl runs inside a single worker invocation (see the internal
// route's maxDuration) — capped well short of "the whole internet" so one
// job reliably finishes instead of timing out mid-crawl and leaving a job
// stuck RUNNING until stale-recovery resets it (which would re-crawl from
// scratch, not resume). Big wikis get their most-substantial N pages by
// content length (see rankPagesByLength) — listAllPages' own native order
// is alphabetical by title, which would otherwise make the pages actually
// imported an arbitrary function of the alphabet, not of what's actually
// the meat of the wiki's lore.
//
// Raised from 150 alongside batching storeLoreChunks' embed calls
// (EMBED_BATCH_SIZE below): live timing against a real wiki found the old
// one-chunk-at-a-time embedding loop, not the MediaWiki API calls, was
// the real ceiling on how many pages fit in one worker invocation —
// batching that loop frees enough headroom to raise this safely. The
// exact new number is an estimate from real API timing plus an assumed
// (unconfirmed — no OPENAI_API_KEY available to measure directly)
// embedding latency; verify against a real key before trusting it fully.
export const WIKI_MAX_PAGES = 400
// How many candidate titles to consider ranking before selecting the top
// WIKI_MAX_PAGES by length — bigger than WIKI_MAX_PAGES so a large wiki's
// alphabetically-early pages don't win by default just for being listed
// first, but bounded so the extra prop=info ranking calls can't run away
// on an enormous wiki.
const WIKI_RANKING_CANDIDATE_CEILING = 2500
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

  let candidates = await listAllPages(apiBase, WIKI_RANKING_CANDIDATE_CEILING)
  if (candidates.length === 0) throw new Error('No pages found on that wiki')

  // Drop anything in an admin-excluded category (e.g. "Characters") before
  // ranking or fetching ever touches it — the whole point is to skip the
  // fetch/embed cost on unwanted pages, not just hide them from the
  // digest afterward. Best-effort per category: one category's lookup
  // failing doesn't block the others or the import as a whole.
  const excludeCategories = Array.isArray(job.excludeCategories) ? job.excludeCategories : []
  if (excludeCategories.length > 0) {
    const excludedTitles = new Set<string>()
    for (const category of excludeCategories) {
      try {
        const members = await fetchCategoryMembers(apiBase, category)
        for (const title of members) excludedTitles.add(title)
      } catch (err) {
        console.error(`Failed to resolve excluded category "${category}" — its pages will still be crawled:`, err)
      }
    }
    if (excludedTitles.size > 0) {
      candidates = candidates.filter(p => !excludedTitles.has(p.title))
    }
  }

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

// One batched embedding call per group instead of one call per chunk.
// Live timing against a real wiki (harrypotter.fandom.com) found this
// loop's old one-chunk-at-a-time embed calls were the dominant cost of a
// wiki import — hundreds of sequential round-trips, well past the
// MediaWiki API calls around it, which are already batched. Matches
// WIKI_EXTRACT_BATCH_SIZE's existing group size for consistency.
const EMBED_BATCH_SIZE = 20

function chunkContentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

/**
 * Embed and insert each chunk as its own LoreEntry row, resuming for free
 * on a retried job instead of re-embedding and re-inserting chunks it
 * already stored. Each chunk's contentHash is checked against what this
 * SAME job (not the whole campaign — see LoreEntry.contentHash's own doc
 * comment) already has BEFORE it's sent to the embedding API at all, so a
 * job that restarts from page 0 after a mid-crawl failure skips both the
 * embedding cost and the write for everything already done, not just the
 * write. The @@unique([jobId, contentHash]) constraint (ON CONFLICT DO
 * NOTHING below) is a defensive backstop against a race between two
 * concurrent workers on the same job, not the primary de-dup mechanism.
 *
 * Uses raw SQL for the vector column (Prisma has no native vector type —
 * see memoryCreation.ts for the same pattern). A batch failing to embed
 * degrades to one-at-a-time for just that batch rather than losing every
 * chunk in it; a chunk that still fails there is logged and skipped — so
 * a flaky embedding call on page 80 of 150 doesn't lose everything
 * already imported.
 */
async function storeLoreChunks(
  campaignId: string,
  jobId: string,
  chunks: TextChunk[],
  sourceUrl?: string
): Promise<number> {
  let stored = 0

  const existing = await prisma.loreEntry.findMany({
    where: { jobId },
    select: { contentHash: true },
  })
  const alreadyStored = new Set(existing.map(e => e.contentHash))

  const withHash = chunks.map(chunk => ({ chunk, hash: chunkContentHash(chunk.content) }))
  const toStore = withHash.filter(c => !alreadyStored.has(c.hash))
  const skipped = withHash.length - toStore.length
  if (skipped > 0) {
    console.log(`⏭️  Skipping ${skipped} already-stored chunk(s) for job ${jobId} (resumed)`)
  }

  for (let i = 0; i < toStore.length; i += EMBED_BATCH_SIZE) {
    const batch = toStore.slice(i, i + EMBED_BATCH_SIZE)
    let vectors: (string | null)[]
    try {
      vectors = await embedBatchWithCostTracking(campaignId, batch.map(c => c.chunk.content), 'lore_import_embedding')
    } catch (error) {
      console.error(`Batch embed failed for ${batch.length} lore chunk(s) — falling back to one-at-a-time:`, error)
      vectors = await Promise.all(
        batch.map(async ({ chunk }) => {
          try {
            return await embedWithCostTracking(campaignId, chunk.content, 'lore_import_embedding')
          } catch (chunkError) {
            console.error(`Failed to embed lore chunk "${chunk.title}":`, chunkError)
            return null
          }
        })
      )
    }

    for (let j = 0; j < batch.length; j++) {
      const embeddingString = vectors[j]
      if (!embeddingString) continue
      const { chunk, hash } = batch[j]
      try {
        const inserted = await prisma.$executeRaw`
          INSERT INTO lore_entries (
            id, "campaignId", "jobId", title, "sourceUrl", content, embedding, tags, "contentHash", "createdAt"
          ) VALUES (
            gen_random_uuid(),
            ${campaignId},
            ${jobId},
            ${chunk.title},
            ${sourceUrl ?? null},
            ${chunk.content},
            ${embeddingString}::vector,
            ARRAY[]::text[],
            ${hash},
            NOW()
          )
          ON CONFLICT ("jobId", "contentHash") DO NOTHING
        `
        if (inserted > 0) stored++
      } catch (error) {
        console.error(`Failed to store lore chunk "${chunk.title}":`, error)
      }
    }
  }
  return stored
}
