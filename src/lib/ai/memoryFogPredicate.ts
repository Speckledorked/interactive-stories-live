// src/lib/ai/memoryFogPredicate.ts
// #390: ONE fog-of-war predicate for memory retrieval, shared by every
// query that pulls memories into an AI-facing prompt.
//
// There are two such queries — memoryRetrieval.ts's semantic search and
// crossEntityRecall.ts's pairwise intersection — and they were written to
// the same INTERFACE (same columns, same RetrievedMemory type, same
// ranking helper) but not to the same CONTRACT.
//
// memoryRetrieval excluded a memory the moment ANY entity it involves was
// undiscovered. crossEntityRecall checked only the TWO ids it was queried
// with, so a memory involving discovered A and B plus undiscovered C went
// straight into the GM prompt and taught the narrator about an entity the
// party has never met.
//
// The rule was reimplemented per call site, which is the only reason the
// two could disagree. Expressed once, they cannot drift again.

import { Prisma } from '@prisma/client'

/**
 * Excludes any memory involving an undiscovered NPC or faction.
 *
 * Deliberately checks the memory's OWN involved-entity arrays rather than
 * trusting the caller's roster to already be clean — the API-route layer
 * has a real, AST-enforced visibleTo() gate (fogOfWar.test.ts), but these
 * queries feed the narration prompt directly and are the last line.
 *
 * Character ids are not checked: a player character is not subject to
 * discovery, and a character id simply won't match either table.
 *
 * Written against the bare column names, so it composes into any WHERE
 * clause selecting from campaign_memories (or a CTE over it).
 */
export const MEMORY_FOG_PREDICATE = Prisma.sql`
  NOT EXISTS (
    SELECT 1 FROM unnest("involvedNpcIds") AS npc_id
    JOIN "NPC" ON "NPC"."id" = npc_id
    WHERE "NPC"."isDiscovered" = false
  )
  AND NOT EXISTS (
    SELECT 1 FROM unnest("involvedFactionIds") AS faction_id
    JOIN "Faction" ON "Faction"."id" = faction_id
    WHERE "Faction"."isDiscovered" = false
  )
`

/**
 * #392: excludes memories consolidation has archived.
 *
 * The semantic path already excludes them implicitly (an archived memory
 * has no embedding, and the indexed CTE requires `embedding IS NOT NULL`),
 * but crossEntityRecall does not go through that CTE — so without this it
 * would keep returning rows that the RAG index has deliberately retired.
 * Stated explicitly in both places rather than relying on a side effect of
 * the embedding being null.
 */
export const MEMORY_LIVE_PREDICATE = Prisma.sql`"archivedAt" IS NULL`
