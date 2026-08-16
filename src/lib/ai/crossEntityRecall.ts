// src/lib/ai/crossEntityRecall.ts
// "What happened between X and Y" — memories that involve BOTH of two
// entities at once, as opposed to memoryRetrieval.ts's per-entity lookups
// (a union, not an intersection). Split out of memoryRetrieval.ts: this is
// its own combinatorics problem (pairing N mentioned entities, capped
// against a player-controlled amplification factor) layered on top of a
// database read, not another flavor of the semantic/single-entity search
// that file does — crossEntityRecall.test.ts already tested this as its
// own unit before the production code caught up to that boundary.

import { prisma } from '@/lib/prisma';
import { MEMORY_SEARCH_COLUMNS } from './campaignMemoryColumns';
import { MEMORY_FOG_PREDICATE, MEMORY_LIVE_PREDICATE } from './memoryFogPredicate';
import type { RetrievedMemory } from './memoryRetrieval';

/**
 * Hard ceiling on how many cross-entity recall pairs one scene can generate.
 *
 * The entity list this pairs up comes from substring-matching PLAYER-WRITTEN
 * action text against known entity names (see worldState.ts), and pairing is
 * combinatorial — n mentions produce n(n-1)/2 pairs, each firing its own DB
 * query in a Promise.all. So a player could name-drop a dozen known NPCs in
 * one action and turn a single scene resolution into ~66 parallel vector
 * queries, purely by typing. That's a player-controlled amplification factor
 * on someone else's infrastructure, which is exactly the kind of thing that
 * should have a number attached to it rather than an assumption that nobody
 * will.
 *
 * capForPrompt (#37) doesn't help here: it bounds the world-state entity
 * lists, not this recall path.
 */
export const MAX_ENTITY_PAIRS = 12

/**
 * Pure helper: unique unordered pairs from a list of mentioned entity IDs,
 * for feeding retrieveCrossEntityHistory once per pair. No DB access — kept
 * separate so this combinatorics logic is testable on its own.
 *
 * Capped at MAX_ENTITY_PAIRS. The cap keeps pairs among the EARLIEST-listed
 * entities rather than taking an arbitrary slice of the full pair list:
 * callers pass entities in relevance order (the scene's own NPCs/factions
 * before incidental name-drops), so this degrades toward the mentions that
 * actually matter instead of whichever pairs the nested loop reached first.
 */
export function generateEntityPairs(
  entityIds: string[],
  maxPairs: number = MAX_ENTITY_PAIRS
): Array<[string, string]> {
  const unique = Array.from(new Set(entityIds))
  const pairs: Array<[string, string]> = []
  // Widen the considered prefix one entity at a time, so we exhaust all
  // pairs among the most relevant few before reaching further down the list.
  for (let j = 1; j < unique.length && pairs.length < maxPairs; j++) {
    for (let i = 0; i < j && pairs.length < maxPairs; i++) {
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
    const memories = await prisma.$queryRaw<RetrievedMemory[]>`
      SELECT
        ${MEMORY_SEARCH_COLUMNS},
        -- #390: NULL, not 1.0.
        --
        -- This query is a structural intersection ordered by recency, not
        -- a semantic search — there is no query embedding here, so there
        -- is no similarity to report. Reporting a hardcoded 1.0 made these
        -- rows bypass the minSimilarity floor entirely AND carry the
        -- maximum possible base score into the importance-boosted re-sort,
        -- so they won every ranking against memories that were genuinely
        -- similar.
        --
        -- NULL says what is true: unscored. filterAndRankMemories exempts
        -- unscored rows from the floor (they earned their place
        -- structurally) and ranks them after scored ones rather than ahead.
        NULL::float as similarity
      FROM campaign_memories
      WHERE
        "campaignId" = ${campaignId}
        AND (
          ${entityIdA} = ANY("involvedNpcIds")
          OR ${entityIdA} = ANY("involvedFactionIds")
          OR ${entityIdA} = ANY("involvedCharacterIds")
        )
        AND (
          ${entityIdB} = ANY("involvedNpcIds")
          OR ${entityIdB} = ANY("involvedFactionIds")
          OR ${entityIdB} = ANY("involvedCharacterIds")
        )
        -- #285/#327/#390: the SHARED fog predicate. This used to check
        -- only the two ids it was queried with, so a memory involving
        -- discovered A and B plus an undiscovered C was returned straight
        -- into the GM prompt. memoryRetrieval.ts has always excluded a
        -- memory if ANY involved entity is undiscovered; the rule now
        -- lives in one place so the two cannot disagree again.
        AND ${MEMORY_FOG_PREDICATE}
        -- #392: consolidation retires a memory from retrieval without
        -- destroying it; this path doesn't go through the embedding-gated
        -- CTE, so it has to say so itself.
        AND ${MEMORY_LIVE_PREDICATE}
      ORDER BY "turnNumber" DESC
      LIMIT ${limit}
    `;

    return memories;
  } catch (error) {
    console.error('Error retrieving cross-entity history:', error);
    return [];
  }
}
