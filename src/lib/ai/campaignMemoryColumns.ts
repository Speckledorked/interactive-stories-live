// src/lib/ai/campaignMemoryColumns.ts
// The 7-column projection shared by every campaign_memories search query in
// memoryRetrieval.ts (retrieveRelevantHistory, retrieveNpcHistory,
// retrieveCrossEntityHistory) — previously hand-typed identically three
// times, with `similarity` being the only thing that actually differs
// between them (a real pgvector cosine calculation in one, a hardcoded 1.0
// in the other two, which don't rank by relevance). Centralized so a
// column rename or addition is one edit instead of three kept in sync by
// hand, and verified byte-identical against the original three inline
// queries before being wired in.
//
// campaign_memories' columns are camelCase with no @map on the model's
// fields (only @@map on the table itself), so every one has to be quoted
// here — an unquoted identifier would fold to lowercase and silently miss.
//
// Not reused by memoryConsolidation.ts's query: that one selects a
// genuinely different column set (the involved-entity arrays and
// locationTags, not memoryType/importance/emotionalTone), so it isn't the
// same duplication and forcing it onto this fragment would just replace
// one honest inline query with a confusing partial match.

import { Prisma } from '@prisma/client'

export const MEMORY_SEARCH_COLUMNS = Prisma.raw(`
  id,
  "turnNumber" as "turnNumber",
  title,
  summary,
  "memoryType" as "memoryType",
  importance,
  "emotionalTone" as "emotionalTone"
`)
