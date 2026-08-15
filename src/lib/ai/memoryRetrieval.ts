/**
 * Memory Retrieval Service
 *
 * Implements semantic search over campaign history using pgvector.
 * Retrieves relevant memories to maintain long-form continuity in AI responses.
 */

import { prisma } from '@/lib/prisma';
import { embedWithCostTracking } from './embeddingService';
import { MEMORY_SEARCH_COLUMNS } from './campaignMemoryColumns';
import type { Scene, PlayerAction, Character, NPC, Faction } from '@prisma/client';

export interface RetrievalContext {
  currentScene: Scene;
  playerActions: PlayerAction[];
  characters: Character[];
  npcs: NPC[];
  factions: Faction[];
}

export interface RetrievedMemory {
  id: string;
  turnNumber: number;
  title: string;
  summary: string;
  memoryType: string;
  importance: string;
  emotionalTone: string | null;
  similarity: number; // Raw semantic similarity (0-1), independent of recency
  // #293: the same similarity+recency blend the SQL ORDER BY uses, only
  // set by retrieveRelevantHistory (retrieveNpcHistory/
  // retrieveCrossEntityHistory have no recency component to blend, so they
  // never select this). filterAndRankMemories falls back to `similarity`
  // when absent — see its own comment for why this exists at all.
  relevanceScore?: number;
}

export interface RetrievalOptions {
  maxMemories?: number;
  recencyBias?: number; // 0-1, how much to favor recent memories
  minSimilarity?: number; // Minimum similarity threshold
  importanceBoost?: boolean; // Boost important memories in ranking
}

const DEFAULT_OPTIONS: Required<RetrievalOptions> = {
  maxMemories: 10,
  recencyBias: 0.3,
  minSimilarity: 0.7,
  importanceBoost: true,
};

// #349: pgvector's ANN index only accelerates a BARE `embedding <=> $1`
// ORDER BY — the old query wrapped that in the recency-blend arithmetic,
// which defeated the index entirely regardless of recencyBias's value
// (confirmed via EXPLAIN in campaignMemoryAnnIndex.liveDb.test.ts, even
// after #286 restored the index). retrieveRelevantHistory's query below is
// now a two-stage CTE: an inner query does ONLY `campaignId` + `embedding
// IS NOT NULL`, bare `ORDER BY embedding <=> $1 LIMIT candidatePoolSize` —
// deliberately matching the exact minimal shape #286's test proved the
// planner picks the index for — then an outer query applies the
// entity-overlap/fog-of-war filters and the recency blend on that already-
// small, materialized candidate set (no vector operator in scope there, so
// wrapping arithmetic around `similarity` there is free).
//
// This was a real design decision, not just a performance refactor (see
// the issue): the entity/fog filters COULD instead live inside the inner
// query alongside campaignId, which would preserve today's filtering
// semantics exactly (a filtered row never even competes for the LIMIT).
// Deliberately not done: this repo's pgvector is 0.6.0, which predates
// iterative index scans (added in 0.8) — pgvector's own docs describe
// filtered ANN queries applying filters AFTER the index scan, silently
// returning fewer than LIMIT rows when the filter is selective, with no
// mitigation available at this version. A correlated NOT EXISTS subquery
// (the fog-of-war check) is also expensive per-candidate and makes the
// planner considerably less likely to choose the index at all. Moving
// those filters to the outer, non-indexed step avoids both risks, at the
// cost of a real, deliberately-accepted tradeoff: a memory that's
// entity/fog-eligible but ranks outside the inner query's similarity-only
// candidate window is invisible to the outer step, same as any other
// bounded candidate pool in this codebase (cf. Debt economy's `take: 300`
// backstop) — not a tight precision cap, a generous one, verified against
// the same realistic multi-campaign scale #286 established.
const CANDIDATE_POOL_MULTIPLIER = 10;
const MIN_CANDIDATE_POOL_SIZE = 100;

const IMPORTANCE_WEIGHTS: Record<string, number> = {
  CRITICAL: 1.3,
  MAJOR: 1.15,
  NORMAL: 1.0,
  MINOR: 0.85,
};

/**
 * Pure post-processing step applied after the SQL similarity+recency query:
 * filter by minimum similarity, then (optionally) boost by static importance
 * and re-sort. No DB access — kept separate from retrieveRelevantHistory so
 * this ranking logic is testable without mocking pgvector.
 *
 * #293: the importance-boosted re-sort used to key off raw `similarity`
 * alone — silently discarding the SQL's own similarity+recency blend the
 * moment importanceBoost was on (the production default, see
 * sceneResolutionRequest.ts's call site, which passes both recencyBias:0.3
 * AND importanceBoost:true). recencyBias had no effect whatsoever on final
 * ordering in that combination — only on which candidates survived the
 * SQL's own LIMIT cutoff before ever reaching this function. Boosting now
 * multiplies the importance weight onto `relevanceScore` (the blended
 * value) when the caller supplied one, falling back to `similarity` for
 * callers that never blend recency at all (retrieveNpcHistory,
 * retrieveCrossEntityHistory). The minSimilarity floor stays keyed on raw
 * `similarity` either way — it's a semantic-relevance gate, not a
 * recency-blended one.
 */
export function filterAndRankMemories(
  memories: RetrievedMemory[],
  opts: { minSimilarity: number; importanceBoost: boolean; maxMemories: number }
): RetrievedMemory[] {
  let filtered = memories.filter((m) => m.similarity >= opts.minSimilarity);

  if (opts.importanceBoost) {
    filtered = filtered
      .map((m) => ({
        ...m,
        boostedScore: (m.relevanceScore ?? m.similarity) * (IMPORTANCE_WEIGHTS[m.importance] || 1.0),
      }))
      .sort((a, b) => b.boostedScore - a.boostedScore);
  }

  return filtered.slice(0, opts.maxMemories);
}

/**
 * Retrieve relevant campaign memories using semantic search
 *
 * This is the main function for RAG-based memory retrieval. It:
 * 1. Builds a query from current scene context (or reuses one the caller
 *    already built — see precomputedQuery)
 * 2. Generates an embedding for that query
 * 3. Searches the database using pgvector cosine similarity
 * 4. Filters by entity involvement (NPCs, factions, characters)
 * 5. Blends semantic similarity with recency bias
 *
 * @param campaignId - The campaign to search
 * @param context - Current scene context (scene, actions, entities)
 * @param options - Search options
 * @param precomputedQuery - Optional: reuse a query string the caller
 *   already built from this same context via buildSearchQuery, instead of
 *   building an identical one again. sceneResolutionRequest.ts needs the
 *   same query text for lore retrieval too, and buildSearchQuery is pure —
 *   recomputing it from unchanged inputs was wasted work, not a behavior
 *   difference, so this is purely an optimization knob.
 * @returns Array of relevant memories, sorted by relevance
 */
export async function retrieveRelevantHistory(
  campaignId: string,
  context: RetrievalContext,
  options: RetrievalOptions = {},
  precomputedQuery?: string
): Promise<RetrievedMemory[]> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  try {
    // Build search query from current context, unless the caller already built one
    const query = precomputedQuery ?? buildSearchQuery(context);

    if (!query.trim()) {
      console.log('Empty search query, skipping memory retrieval');
      return [];
    }

    // Generate embedding for current context
    const embeddingString = await embedWithCostTracking(campaignId, query, 'memory_retrieval_embedding');

    // Get entity IDs for filtering
    const npcIds = context.npcs.map(n => n.id);
    const factionIds = context.factions.map(f => f.id);
    const characterIds = context.characters.map(c => c.id);

    // Semantic search with pgvector, using cosine distance operator <=>.
    // See the CANDIDATE_POOL_MULTIPLIER comment above for why this is a
    // two-stage CTE rather than one flat query (#349).
    const candidatePoolSize = Math.max(opts.maxMemories * CANDIDATE_POOL_MULTIPLIER, MIN_CANDIDATE_POOL_SIZE);
    // See campaignMemoryColumns.ts for why the shared column list is quoted.
    const memories = await prisma.$queryRaw<RetrievedMemory[]>`
      WITH candidates AS (
        -- Index-accelerated stage: deliberately ONLY campaignId + a bare
        -- vector-distance ORDER BY, matching the exact shape
        -- campaignMemoryAnnIndex.liveDb.test.ts proves the planner picks
        -- the HNSW index for. Nothing else belongs in this stage.
        SELECT
          ${MEMORY_SEARCH_COLUMNS},
          "involvedNpcIds",
          "involvedFactionIds",
          "involvedCharacterIds",
          (1 - (embedding <=> ${embeddingString}::vector)) as similarity
        FROM campaign_memories
        WHERE "campaignId" = ${campaignId} AND embedding IS NOT NULL
        ORDER BY embedding <=> ${embeddingString}::vector
        LIMIT ${candidatePoolSize}
      )
      -- Non-indexed stage: operates on the already-small candidate set
      -- above, so filtering it further and blending in recency here costs
      -- nothing extra — no vector operator is in scope at this point.
      SELECT
        ${MEMORY_SEARCH_COLUMNS},
        similarity,
        -- #293: the same similarity+recency blend, returned as a real
        -- column so filterAndRankMemories's importance-boosted re-sort can
        -- multiply onto it instead of silently discarding the blend back
        -- down to raw similarity.
        similarity * ${1 - opts.recencyBias} +
        ("turnNumber"::float / GREATEST((SELECT MAX("turnNumber") FROM campaign_memories WHERE "campaignId" = ${campaignId}), 1)) * ${opts.recencyBias}
        as "relevanceScore"
      FROM candidates
      WHERE
        -- Entity filtering: include memories involving current NPCs/factions/characters
        -- When arrays are empty, use ARRAY[]::text[] which makes the overlap check return false
        -- This ensures we only match general memories (with no entities) when no entities are provided
        (
          (${npcIds.length > 0} AND "involvedNpcIds" && ${npcIds}::text[])
          OR (${factionIds.length > 0} AND "involvedFactionIds" && ${factionIds}::text[])
          OR (${characterIds.length > 0} AND "involvedCharacterIds" && ${characterIds}::text[])
          OR (
            cardinality("involvedNpcIds") = 0
            AND cardinality("involvedFactionIds") = 0
            AND cardinality("involvedCharacterIds") = 0
          )  -- Also include general memories
        )
        -- #285/#327: fog-of-war independent guard. The API-route layer has
        -- a real, AST-enforced visibleTo() gate (see fogOfWar.test.ts), but
        -- this RAG query feeds the AI-facing narration prompt directly and
        -- had no equivalent — a memory referencing a currently-undiscovered
        -- NPC/faction could be pulled into context by semantic similarity
        -- alone, regardless of whether every upstream caller happened to
        -- have already filtered. Excludes a memory the moment ANY entity it
        -- involves isn't discovered yet, rather than trusting npcIds/
        -- factionIds (the CURRENT scene's roster) to already be clean.
        AND NOT EXISTS (
          SELECT 1 FROM unnest("involvedNpcIds") AS npc_id
          JOIN "NPC" ON "NPC"."id" = npc_id
          WHERE "NPC"."isDiscovered" = false
        )
        AND NOT EXISTS (
          SELECT 1 FROM unnest("involvedFactionIds") AS faction_id
          JOIN "Faction" ON "Faction"."id" = faction_id
          WHERE "Faction"."isDiscovered" = false
        )
      ORDER BY "relevanceScore" DESC
      LIMIT ${opts.maxMemories * 2}  -- Get extra, then filter by similarity threshold
    `;

    // Filter by minimum similarity and apply importance boost
    const result = filterAndRankMemories(memories, opts);

    console.log(`✓ Retrieved ${result.length} relevant memories for scene ${context.currentScene.sceneNumber}`);

    // Fire-and-forget: bump retrievalCount/lastRetrievedTurn for the
    // memories we actually surfaced — a frequency signal
    // memoryConsolidation.ts uses to exempt memories that keep proving
    // useful from being rolled into an era summary (see #107). Never
    // awaited: this must not add latency to the synchronous, pre-callAIGM
    // retrieval path, so a failure here is logged and dropped, never
    // allowed to affect what's returned to the caller.
    if (result.length > 0) {
      recordMemoryRetrievals(campaignId, result.map((m) => m.id)).catch((err) =>
        console.error('Failed to record memory retrieval stats (non-critical):', err)
      );
    }

    return result;
  } catch (error) {
    console.error('Error retrieving campaign memories:', error);
    // Don't fail scene resolution if memory retrieval fails
    return [];
  }
}

/**
 * Best-effort write, never awaited by the caller (see the fire-and-forget
 * call above). Reads the campaign's current turn from WorldMeta rather than
 * taking it as a parameter — retrieveRelevantHistory's callers don't
 * otherwise need turn context, and this write isn't latency-sensitive.
 */
async function recordMemoryRetrievals(campaignId: string, memoryIds: string[]): Promise<void> {
  const worldMeta = await prisma.worldMeta.findUnique({
    where: { campaignId },
    select: { currentTurnNumber: true },
  });

  await prisma.$executeRaw`
    UPDATE campaign_memories
    SET "retrievalCount" = "retrievalCount" + 1, "lastRetrievedTurn" = ${worldMeta?.currentTurnNumber ?? null}
    WHERE id = ANY(${memoryIds}::text[])
  `;
}

/**
 * Build a search query from current scene context
 *
 * Combines scene intro, stakes, player actions, NPC goals, and faction plans
 * into a coherent query for semantic search. Exported so
 * sceneResolutionRequest.ts can build the query once and pass it to both
 * retrieveRelevantHistory (via precomputedQuery) and loreRetrieval.ts's
 * retrieveRelevantLore, rather than each deriving its own from the same
 * context.
 */
export function buildSearchQuery(context: RetrievalContext): string {
  const parts: string[] = [];

  // Scene intro and stakes
  if (context.currentScene.sceneIntroText) {
    parts.push(context.currentScene.sceneIntroText);
  }

  if (context.currentScene.stakes) {
    parts.push(`Stakes: ${context.currentScene.stakes}`);
  }

  // Player actions
  if (context.playerActions.length > 0) {
    const actions = context.playerActions
      .map(a => a.actionText)
      .join(' ');
    parts.push(`Player actions: ${actions}`);
  }

  // NPCs and their goals
  if (context.npcs.length > 0) {
    const npcContext = context.npcs
      .map(n => `${n.name}: ${n.description || ''} ${n.goals || ''}`)
      .join(' ');
    parts.push(`NPCs present: ${npcContext}`);
  }

  // Factions and their plans
  if (context.factions.length > 0) {
    const factionContext = context.factions
      .map(f => `${f.name}: ${f.goals || ''} ${f.currentPlan || ''}`)
      .join(' ');
    parts.push(`Factions involved: ${factionContext}`);
  }

  // Location
  if (context.currentScene.location) {
    parts.push(`Location: ${context.currentScene.location}`);
  }

  return parts.join('\n');
}

/**
 * Retrieve NPC-specific history
 *
 * Gets the most recent memories involving a specific NPC, regardless of
 * importance — a casually-spared minor NPC still needs to be reliably
 * recallable by name, not just NPCs whose moment got flagged MAJOR/CRITICAL.
 * Used both to enrich NPC context when they appear in a scene, and for
 * guaranteed recall when a player explicitly names an NPC in their action
 * (see buildSceneResolutionRequest) — semantic search alone can rank a
 * specific, deliberately-asked-about NPC below whatever's topically louder
 * this turn, so this direct lookup doesn't depend on embedding luck.
 *
 * @param campaignId - Campaign ID
 * @param npcId - NPC ID
 * @param limit - Maximum number of memories to retrieve
 */
export async function retrieveNpcHistory(
  campaignId: string,
  npcId: string,
  limit: number = 5
): Promise<RetrievedMemory[]> {
  try {
    const memories = await prisma.$queryRaw<RetrievedMemory[]>`
      SELECT
        ${MEMORY_SEARCH_COLUMNS},
        1.0 as similarity
      FROM campaign_memories
      WHERE
        "campaignId" = ${campaignId}
        AND ${npcId} = ANY("involvedNpcIds")
        -- #285/#327: same independent fog-of-war guard as
        -- retrieveRelevantHistory above — don't trust the caller to have
        -- already confirmed this NPC is discovered before asking for
        -- their history.
        AND EXISTS (SELECT 1 FROM "NPC" WHERE "NPC"."id" = ${npcId} AND "NPC"."isDiscovered" = true)
      ORDER BY "turnNumber" DESC
      LIMIT ${limit}
    `;

    return memories;
  } catch (error) {
    console.error('Error retrieving NPC history:', error);
    return [];
  }
}

// Cross-entity pair recall (MAX_ENTITY_PAIRS, generateEntityPairs,
// retrieveCrossEntityHistory) moved to crossEntityRecall.ts — its own
// combinatorics problem layered on a DB read, not another flavor of the
// semantic/single-entity search this file does. See that file's header.

// retrieveFactionHistory, retrieveLocationHistory, and getCampaignMemoryStats
// used to live here as speculative built-ahead-of-a-consumer exports; they
// never gained a caller and were removed. Rebuild from git history (or from
// retrieveNpcHistory's shape, which they all mirrored) if a feature actually
// needs one.
