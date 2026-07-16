// src/lib/lore/loreDigest.ts
// Bounded digest of a campaign's imported lore, for grounding WORLD
// GENERATION (factions/capabilities/stat labels/archetypes) in canon.
//
// Scene narration already retrieves lore semantically per scene
// (loreRetrieval.ts); this is the other consumer: generation wants broad
// COVERAGE of the corpus, not relevance to a query — a wiki crawl imports
// thousands of chunks and the great houses may live anywhere in them. So
// instead of embedding-similarity we sample evenly across the whole corpus
// and hard-cap the character budget.

import type { Prisma, PrismaClient } from '@prisma/client'

export const DIGEST_MAX_ENTRIES = 24
export const DIGEST_MAX_CHARS = 12000
// A slice smaller than this is too mangled to inform generation.
const MIN_PER_ENTRY_CHARS = 200

export interface DigestSourceEntry {
  title: string
  content: string
}

export interface LoreDigest {
  digest: string
  totalEntries: number
  sampledEntries: number
}

/**
 * Indices of an evenly spaced sample: `take` picks spread across `total`
 * items so a digest of a large corpus sees its whole breadth, not just
 * the first pages the crawler happened to import.
 */
export function evenlySpacedIndices(total: number, take: number): number[] {
  if (total <= 0 || take <= 0) return []
  if (take >= total) return Array.from({ length: total }, (_, i) => i)
  const step = total / take
  const seen = new Set<number>()
  for (let i = 0; i < take; i++) {
    seen.add(Math.min(total - 1, Math.floor(i * step)))
  }
  return Array.from(seen).sort((a, b) => a - b)
}

/**
 * Join sampled entries into one bounded string. Each entry gets an even
 * share of the budget (floored at MIN_PER_ENTRY_CHARS); entries that no
 * longer fit are dropped rather than squeezed into uselessness.
 */
export function formatLoreDigest(
  entries: DigestSourceEntry[],
  maxChars: number = DIGEST_MAX_CHARS
): string {
  if (entries.length === 0) return ''
  const perEntry = Math.max(MIN_PER_ENTRY_CHARS, Math.floor(maxChars / entries.length))
  const parts: string[] = []
  let used = 0
  for (const entry of entries) {
    const content =
      entry.content.length > perEntry
        ? entry.content.slice(0, perEntry - 1).trimEnd() + '…'
        : entry.content
    const block = `### ${entry.title}\n${content}`
    if (used + block.length > maxChars && parts.length > 0) break
    parts.push(block)
    used += block.length + 2
  }
  return parts.join('\n\n')
}

type Db = PrismaClient | Prisma.TransactionClient

/**
 * Sample the campaign's imported lore into a generation-ready digest, or
 * null when nothing has been imported. Explicit `select`s only — the
 * embedding column is an Unsupported() vector Prisma must never touch.
 */
export async function buildLoreDigest(
  db: Db,
  campaignId: string,
  opts?: { maxEntries?: number; maxChars?: number }
): Promise<LoreDigest | null> {
  const ids = await db.loreEntry.findMany({
    where: { campaignId },
    select: { id: true },
    orderBy: { id: 'asc' },
  })
  if (ids.length === 0) return null

  const indices = evenlySpacedIndices(ids.length, opts?.maxEntries ?? DIGEST_MAX_ENTRIES)
  const sampleIds = indices.map(i => ids[i].id)
  const rows = await db.loreEntry.findMany({
    where: { id: { in: sampleIds } },
    select: { title: true, content: true },
    orderBy: { id: 'asc' },
  })

  return {
    digest: formatLoreDigest(rows, opts?.maxChars),
    totalEntries: ids.length,
    sampledEntries: rows.length,
  }
}
