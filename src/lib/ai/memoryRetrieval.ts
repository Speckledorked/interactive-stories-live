/**
 * Memory Retrieval Service
 *
 * Implements semantic search over campaign history using pgvector.
 * Retrieves relevant memories to maintain long-form continuity in AI responses.
 */

import { prisma } from '@/lib/prisma';
import { generateEmbedding, embeddingToPostgresVector } from './embeddingService';
import { recordAICost, estimateTokenCount } from './cost-tracker';
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
  similarity: number; // How relevant this memory is (0-1)
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
        boostedScore: m.similarity * (IMPORTANCE_WEIGHTS[m.importance] || 1.0),
      }))
      .sort((a, b) => b.boostedScore - a.boostedScore);
  }

  return filtered.slice(0, opts.maxMemories);
}

/**
 * Retrieve relevant campaign memories using semantic search
 *
 * This is the main function for RAG-based memory retrieval. It:
 * 1. Builds a query from current scene context
 * 2. Generates an embedding for that query
 * 3. Searches the database using pgvector cosine similarity
 * 4. Filters by entity involvement (NPCs, factions, characters)
 * 5. Blends semantic similarity with recency bias
 *
 * @param campaignId - The campaign to search
 * @param context - Current scene context (scene, actions, entities)
 * @param options - Search options
 * @returns Array of relevant memories, sorted by relevance
 */
export async function retrieveRelevantHistory(
  campaignId: string,
  context: RetrievalContext,
  options: RetrievalOptions = {}
): Promise<RetrievedMemory[]> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  try {
    // Build search query from current context
    const query = buildSearchQuery(context);

    if (!query.trim()) {
      console.log('Empty search query, skipping memory retrieval');
      return [];
    }

    // Generate embedding for current context
    const embeddingStartTime = Date.now();
    const queryEmbedding = await generateEmbedding(query);
    const embeddingString = embeddingToPostgresVector(queryEmbedding);

    await recordAICost({
      campaignId,
      model: 'text-embedding-ada-002',
      requestType: 'memory_retrieval_embedding',
      inputTokens: estimateTokenCount(query),
      outputTokens: 0,
      responseTimeMs: Date.now() - embeddingStartTime,
      success: true
    }).catch(console.error);

    // Get entity IDs for filtering
    const npcIds = context.npcs.map(n => n.id);
    const factionIds = context.factions.map(f => f.id);
    const characterIds = context.characters.map(c => c.id);

    // Semantic search with pgvector
    // Uses cosine distance operator <=> (1 - cosine similarity)
    // Handle empty entity arrays by providing empty arrays to PostgreSQL
    // PostgreSQL's && operator returns false when one array is empty, which is what we want
    const memories = await prisma.$queryRaw<any[]>`
      SELECT
        id,
        turn_number as "turnNumber",
        title,
        summary,
        memory_type as "memoryType",
        importance,
        emotional_tone as "emotionalTone",
        (1 - (embedding <=> ${embeddingString}::vector)) as similarity
      FROM campaign_memories
      WHERE
        campaign_id = ${campaignId}
        AND embedding IS NOT NULL
        -- Entity filtering: include memories involving current NPCs/factions/characters
        -- When arrays are empty, use ARRAY[]::text[] which makes the overlap check return false
        -- This ensures we only match general memories (with no entities) when no entities are provided
        AND (
          (${npcIds.length > 0} AND involved_npc_ids && ${npcIds}::text[])
          OR (${factionIds.length > 0} AND involved_faction_ids && ${factionIds}::text[])
          OR (${characterIds.length > 0} AND involved_character_ids && ${characterIds}::text[])
          OR (
            cardinality(involved_npc_ids) = 0
            AND cardinality(involved_faction_ids) = 0
            AND cardinality(involved_character_ids) = 0
          )  -- Also include general memories
        )
      ORDER BY
        -- Blend similarity with recency and importance
        (1 - (embedding <=> ${embeddingString}::vector)) * ${1 - opts.recencyBias} +
        (turn_number::float / GREATEST((SELECT MAX(turn_number) FROM campaign_memories WHERE campaign_id = ${campaignId}), 1)) * ${opts.recencyBias}
        DESC
      LIMIT ${opts.maxMemories * 2}  -- Get extra, then filter by similarity threshold
    `;

    // Filter by minimum similarity and apply importance boost
    const result = filterAndRankMemories(memories, opts);

    console.log(`✓ Retrieved ${result.length} relevant memories for scene ${context.currentScene.sceneNumber}`);

    return result;
  } catch (error) {
    console.error('Error retrieving campaign memories:', error);
    // Don't fail scene resolution if memory retrieval fails
    return [];
  }
}

/**
 * Build a search query from current scene context
 *
 * Combines scene intro, stakes, player actions, NPC goals, and faction plans
 * into a coherent query for semantic search. Exported so lib/ai/loreRetrieval.ts
 * can search imported lore against the same "what's this scene about" text
 * instead of re-deriving its own.
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
    const memories = await prisma.$queryRaw<any[]>`
      SELECT
        id,
        turn_number as "turnNumber",
        title,
        summary,
        memory_type as "memoryType",
        importance,
        emotional_tone as "emotionalTone",
        1.0 as similarity
      FROM campaign_memories
      WHERE
        campaign_id = ${campaignId}
        AND ${npcId} = ANY(involved_npc_ids)
      ORDER BY turn_number DESC
      LIMIT ${limit}
    `;

    return memories;
  } catch (error) {
    console.error('Error retrieving NPC history:', error);
    return [];
  }
}

/**
 * Pure helper: every unique unordered pair from a list of mentioned entity
 * IDs, for feeding retrieveCrossEntityHistory once per pair. No DB access —
 * kept separate so this combinatorics logic is testable on its own.
 */
export function generateEntityPairs(entityIds: string[]): Array<[string, string]> {
  const unique = Array.from(new Set(entityIds))
  const pairs: Array<[string, string]> = []
  for (let i = 0; i < unique.length; i++) {
    for (let j = i + 1; j < unique.length; j++) {
      pairs.push([unique[i], unique[j]])
    }
  }
  return pairs
}

/**
 * Retrieve memories that involve BOTH of two entities — "what happened
 * between X and Y" — as opposed to retrieveNpcHistory, which returns
 * everything involving just one entity (a union, not an intersection).
 * Either ID can be an NPC, faction, or character; a memory
 * matches only if both IDs appear somewhere across its three
 * involved-entity arrays, regardless of which array either one is in — so
 * this also answers "history between this NPC and this faction" or
 * "between these two player characters", not just NPC-NPC pairs.
 *
 * @param campaignId - Campaign ID
 * @param entityIdA - First entity's ID (NPC, faction, or character)
 * @param entityIdB - Second entity's ID (NPC, faction, or character)
 * @param limit - Maximum number of memories to retrieve
 */
export async function retrieveCrossEntityHistory(
  campaignId: string,
  entityIdA: string,
  entityIdB: string,
  limit: number = 5
): Promise<RetrievedMemory[]> {
  try {
    const memories = await prisma.$queryRaw<any[]>`
      SELECT
        id,
        turn_number as "turnNumber",
        title,
        summary,
        memory_type as "memoryType",
        importance,
        emotional_tone as "emotionalTone",
        1.0 as similarity
      FROM campaign_memories
      WHERE
        campaign_id = ${campaignId}
        AND (
          ${entityIdA} = ANY(involved_npc_ids)
          OR ${entityIdA} = ANY(involved_faction_ids)
          OR ${entityIdA} = ANY(involved_character_ids)
        )
        AND (
          ${entityIdB} = ANY(involved_npc_ids)
          OR ${entityIdB} = ANY(involved_faction_ids)
          OR ${entityIdB} = ANY(involved_character_ids)
        )
      ORDER BY turn_number DESC
      LIMIT ${limit}
    `;

    return memories;
  } catch (error) {
    console.error('Error retrieving cross-entity history:', error);
    return [];
  }
}

// retrieveFactionHistory, retrieveLocationHistory, and getCampaignMemoryStats
// used to live here as speculative built-ahead-of-a-consumer exports; they
// never gained a caller and were removed. Rebuild from git history (or from
// retrieveNpcHistory's shape, which they all mirrored) if a feature actually
// needs one.
