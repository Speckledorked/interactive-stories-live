/**
 * Lore Retrieval Service
 *
 * Semantic search over imported LoreEntry rows (pasted text, single pages,
 * and whole wikis — see lib/lore/). Mirrors memoryRetrieval.ts's
 * pgvector-based search, but scoped to one campaign's static reference
 * material rather than its play history.
 */

import { prisma } from '@/lib/prisma';
import { generateEmbedding, embeddingToPostgresVector } from './embeddingService';

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

const DEFAULT_OPTIONS: Required<LoreRetrievalOptions> = {
  maxEntries: 5,
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
    const queryEmbedding = await generateEmbedding(queryText);
    const embeddingString = embeddingToPostgresVector(queryEmbedding);

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
