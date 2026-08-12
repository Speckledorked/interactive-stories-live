/**
 * Lore Retrieval Service
 *
 * Semantic search over imported LoreEntry rows (pasted text, single pages,
 * and whole wikis — see lib/lore/). Mirrors memoryRetrieval.ts's
 * pgvector-based search, but scoped to one campaign's static reference
 * material rather than its play history.
 */

import { prisma } from '@/lib/prisma';
import { embedWithCostTracking } from './embeddingService';

export interface RetrievedLoreEntry {
  id: string;
  title: string;
  content: string;
  sourceUrl: string | null;
  similarity: number;
}

export interface LoreRetrievalOptions {
  maxEntries?: number;
  minSimilarity?: number;
}

// maxEntries raised from 5 — a modest, not multiplied, increase since
// this runs on every scene (a recurring per-scene cost), unlike the
// one-time campaign-creation lore digest. minSimilarity is left
// unchanged: loosening it would pull weaker matches into every single
// scene call, a standing quality/cost trade-off paid every scene rather
// than once, and wasn't asked for.
const DEFAULT_OPTIONS: Required<LoreRetrievalOptions> = {
  maxEntries: 8,
  minSimilarity: 0.75,
};

/**
 * Retrieve the campaign's imported lore entries most relevant to the given
 * query text (typically the same scene-context string used for memory
 * retrieval — see worldState.ts). Returns [] on any failure or if the
 * campaign has no imported lore, so a broken/slow embedding call never
 * blocks scene resolution.
 */
export async function retrieveRelevantLore(
  campaignId: string,
  queryText: string,
  options: LoreRetrievalOptions = {}
): Promise<RetrievedLoreEntry[]> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  if (!queryText.trim()) {
    return [];
  }

  try {
    // Cost-tracked, matching memoryRetrieval.ts's equivalent memory-search
    // embedding call — this call site previously went untracked entirely.
    const embeddingString = await embedWithCostTracking(campaignId, queryText, 'lore_retrieval_embedding');

    const entries = await prisma.$queryRaw<any[]>`
      SELECT
        id,
        title,
        content,
        "sourceUrl" as "sourceUrl",
        (1 - (embedding <=> ${embeddingString}::vector)) as similarity
      FROM lore_entries
      WHERE
        "campaignId" = ${campaignId}
        AND embedding IS NOT NULL
      ORDER BY embedding <=> ${embeddingString}::vector
      LIMIT ${opts.maxEntries * 3}
    `;

    return entries
      .filter((e) => e.similarity >= opts.minSimilarity)
      .slice(0, opts.maxEntries);
  } catch (error) {
    console.error('Error retrieving campaign lore:', error);
    return [];
  }
}

/**
 * Persist which retrieved lore entries actually reached a scene's prompt,
 * so "why did this narration mention that fact" is a real join
 * (Scene -> LoreCitation -> LoreEntry) instead of a guess. Best-effort and
 * fire-and-forget by design — a citation-write failure must never affect
 * scene resolution, which has already succeeded or failed by the time this
 * runs. Call right after retrieveRelevantLore returns.
 */
export async function recordLoreCitations(
  campaignId: string,
  sceneId: string,
  entries: RetrievedLoreEntry[]
): Promise<void> {
  if (entries.length === 0) return;

  try {
    await prisma.loreCitation.createMany({
      data: entries.map((entry) => ({
        campaignId,
        sceneId,
        loreEntryId: entry.id,
        similarity: entry.similarity,
      })),
    });
  } catch (error) {
    console.error('Error recording lore citations:', error);
  }
}
