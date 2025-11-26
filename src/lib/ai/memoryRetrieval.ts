/**
 * Memory Retrieval Service
 *
 * Implements semantic search over campaign history using pgvector.
 * Retrieves relevant memories to maintain long-form continuity in AI responses.
 */

import { prisma } from '@/lib/prisma';
import { generateEmbedding, embeddingToPostgresVector } from './embeddingService';
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
    const queryEmbedding = await generateEmbedding(query);
    const embeddingString = embeddingToPostgresVector(queryEmbedding);

    // Get entity IDs for filtering
    const npcIds = context.npcs.map(n => n.id);
    const factionIds = context.factions.map(f => f.id);
    const characterIds = context.characters.map(c => c.id);

    // Semantic search with pgvector
    // Uses cosine distance operator <=> (1 - cosine similarity)
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
        AND (
          involved_npc_ids && ${npcIds}::text[]
          OR involved_faction_ids && ${factionIds}::text[]
          OR involved_character_ids && ${characterIds}::text[]
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
    let filteredMemories = memories.filter(m => m.similarity >= opts.minSimilarity);

    // Apply importance boost if enabled
    if (opts.importanceBoost) {
      const importanceWeights = {
        CRITICAL: 1.3,
        MAJOR: 1.15,
        NORMAL: 1.0,
        MINOR: 0.85,
      };

      filteredMemories = filteredMemories
        .map(m => ({
          ...m,
          boostedScore: m.similarity * (importanceWeights[m.importance as keyof typeof importanceWeights] || 1.0),
        }))
        .sort((a, b) => b.boostedScore - a.boostedScore);
    }

    const result = filteredMemories.slice(0, opts.maxMemories);

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
 * into a coherent query for semantic search.
 */
function buildSearchQuery(context: RetrievalContext): string {
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
 * Gets the most recent and important memories involving a specific NPC.
 * Useful for enriching NPC context when they appear in a scene.
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
        AND importance IN ('MAJOR', 'CRITICAL')
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
 * Retrieve faction-specific history
 *
 * Gets the most recent and important memories involving a specific faction.
 *
 * @param campaignId - Campaign ID
 * @param factionId - Faction ID
 * @param limit - Maximum number of memories to retrieve
 */
export async function retrieveFactionHistory(
  campaignId: string,
  factionId: string,
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
        AND ${factionId} = ANY(involved_faction_ids)
        AND importance IN ('MAJOR', 'CRITICAL')
      ORDER BY turn_number DESC
      LIMIT ${limit}
    `;

    return memories;
  } catch (error) {
    console.error('Error retrieving faction history:', error);
    return [];
  }
}

/**
 * Retrieve memories by location
 *
 * Gets memories that occurred at a specific location.
 *
 * @param campaignId - Campaign ID
 * @param location - Location tag
 * @param limit - Maximum number of memories
 */
export async function retrieveLocationHistory(
  campaignId: string,
  location: string,
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
        AND ${location} = ANY(location_tags)
      ORDER BY turn_number DESC
      LIMIT ${limit}
    `;

    return memories;
  } catch (error) {
    console.error('Error retrieving location history:', error);
    return [];
  }
}

/**
 * Get campaign memory statistics
 *
 * Returns stats about the campaign's memory database.
 *
 * @param campaignId - Campaign ID
 */
export async function getCampaignMemoryStats(campaignId: string) {
  try {
    const stats = await prisma.$queryRaw<any[]>`
      SELECT
        COUNT(*) as total_memories,
        COUNT(CASE WHEN importance = 'CRITICAL' THEN 1 END) as critical_memories,
        COUNT(CASE WHEN importance = 'MAJOR' THEN 1 END) as major_memories,
        COUNT(CASE WHEN embedding IS NOT NULL THEN 1 END) as memories_with_embeddings,
        MIN(turn_number) as earliest_turn,
        MAX(turn_number) as latest_turn
      FROM campaign_memories
      WHERE campaign_id = ${campaignId}
    `;

    return stats[0] || null;
  } catch (error) {
    console.error('Error getting memory stats:', error);
    return null;
  }
}
