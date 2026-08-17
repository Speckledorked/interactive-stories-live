/**
 * Memory Consolidation
 *
 * campaign_memories is never capped at write time (see memoryCreation.ts) —
 * nearly every tick change, scene, and offscreen event gets its own row, so a
 * long campaign accumulates far more rows than the README's own "100+ scene
 * campaign" scale target implies (several hundred to low thousands, not
 * ~100). This periodically rolls up old memories into per-era summaries so
 * the table stays bounded.
 *
 * Two tiers, on two different horizons — not one pass:
 *  - MINOR/NORMAL: rolled up after CONSOLIDATION_AGE_TURNS (20 turns), in
 *    narrow CONSOLIDATION_BUCKET_SIZE (10-turn) windows. These are the
 *    day-to-day texture of play; nothing is lost by summarizing them soon.
 *  - MAJOR/CRITICAL (#216): these are exactly the moments long-term recall
 *    exists for, so they get a MUCH longer horizon
 *    (MAJOR_CONSOLIDATION_AGE_TURNS) and a wider bucket window
 *    (MAJOR_CONSOLIDATION_BUCKET_SIZE — they're rarer events by nature, so a
 *    10-turn window would almost never reach MIN_BUCKET_SIZE_TO_CONSOLIDATE
 *    for them). Previously permanently exempt, which meant this tier grew
 *    unbounded on any campaign that ran long enough — directly
 *    contradicting this module's own "bounding table growth" framing. The
 *    resulting era summary keeps MAJOR importance (not NORMAL, unlike the
 *    MINOR/NORMAL tier's summary) so it isn't silently deprioritized at
 *    retrieval time the same way a "quieter stretch" summary should be.
 */

import { prisma } from '@/lib/prisma'
import { createCampaignMemory } from './memoryCreation'
import type { MemoryImportance } from '@prisma/client'

const CONSOLIDATION_AGE_TURNS = 20 // only touch memories at least this many turns old
const CONSOLIDATION_BUCKET_SIZE = 10 // group eligible memories into turn-number windows this wide
const MIN_BUCKET_SIZE_TO_CONSOLIDATE = 3 // skip buckets too small to be worth collapsing
export const ERA_SUMMARY_TAG = 'era-summary' // marks a consolidated row so it's never re-consolidated

// #216: MAJOR/CRITICAL consolidation horizon — see the module comment above
// for why this is so much longer/wider than the MINOR/NORMAL tier's.
const MAJOR_CONSOLIDATION_AGE_TURNS = 150
const MAJOR_CONSOLIDATION_BUCKET_SIZE = 50

// A memory retrieved often, and recently, keeps proving useful for recall —
// exempt it the same way MAJOR/CRITICAL importance already is, rather than
// flattening it into a "quieter stretch" summary just because it's old and
// low-importance (see #107).
const FREQUENT_RETRIEVAL_MIN_COUNT = 3 // retrieved at least this many times...
const FREQUENT_RETRIEVAL_RECENCY_TURNS = 15 // ...with at least one of those within this many turns of now

export interface EligibleMemoryRow {
  id: string
  turnNumber: number
  title: string
  summary: string
  involvedCharacterIds: string[]
  involvedNpcIds: string[]
  involvedFactionIds: string[]
  locationTags: string[]
  retrievalCount: number
  lastRetrievedTurn: number | null
}

/**
 * Pure exemption decision — no DB access, safe to unit test directly. See
 * FREQUENT_RETRIEVAL_MIN_COUNT/FREQUENT_RETRIEVAL_RECENCY_TURNS above for
 * why both a count and a recency bound are required: a memory retrieved
 * many times but not recently was useful once, not still useful now.
 */
export function isFrequentlyRetrieved(
  memory: { retrievalCount: number; lastRetrievedTurn: number | null },
  currentTurn: number
): boolean {
  if (memory.retrievalCount < FREQUENT_RETRIEVAL_MIN_COUNT) return false
  if (memory.lastRetrievedTurn === null) return false
  return currentTurn - memory.lastRetrievedTurn <= FREQUENT_RETRIEVAL_RECENCY_TURNS
}

export interface ConsolidationBucket {
  startTurn: number
  endTurn: number
  maxTurn: number
  memories: EligibleMemoryRow[]
}

/**
 * Pure grouping decision: given already-eligible (old, not-yet-consolidated)
 * memories, group them into fixed turn-number windows and drop any window
 * too small to be worth collapsing into one row. No DB access — the caller
 * is responsible for filtering eligibility and for actually writing/
 * deleting rows.
 *
 * bucketSize defaults to CONSOLIDATION_BUCKET_SIZE (the MINOR/NORMAL tier's
 * width) so every existing caller/test keeps its exact prior behavior;
 * #216's MAJOR/CRITICAL tier passes MAJOR_CONSOLIDATION_BUCKET_SIZE instead.
 */
export function decideConsolidationBuckets(
  eligible: EligibleMemoryRow[],
  bucketSize: number = CONSOLIDATION_BUCKET_SIZE
): ConsolidationBucket[] {
  const buckets = new Map<number, EligibleMemoryRow[]>()
  for (const memory of eligible) {
    const bucketKey = Math.floor((memory.turnNumber - 1) / bucketSize)
    const bucket = buckets.get(bucketKey) || []
    bucket.push(memory)
    buckets.set(bucketKey, bucket)
  }

  const result: ConsolidationBucket[] = []
  for (const [bucketKey, memories] of buckets) {
    if (memories.length < MIN_BUCKET_SIZE_TO_CONSOLIDATE) continue
    const startTurn = bucketKey * bucketSize + 1
    const endTurn = startTurn + bucketSize - 1
    const maxTurn = Math.max(...memories.map((m) => m.turnNumber))
    result.push({ startTurn, endTurn, maxTurn, memories })
  }
  return result
}

interface ConsolidationTierConfig {
  ageThreshold: number
  bucketSize: number
  importanceFilter: readonly MemoryImportance[]
  resultImportance: MemoryImportance
  /** "minor events" / "major events" — feeds the era-summary title. */
  eventLabel: string
  /** "a quieter stretch" / "a consequential stretch" — feeds the era-summary body. */
  stretchLabel: string
}

const MINOR_TIER: ConsolidationTierConfig = {
  ageThreshold: CONSOLIDATION_AGE_TURNS,
  bucketSize: CONSOLIDATION_BUCKET_SIZE,
  importanceFilter: ['MINOR', 'NORMAL'],
  resultImportance: 'NORMAL',
  eventLabel: 'minor events',
  stretchLabel: 'A quieter stretch',
}

const MAJOR_TIER: ConsolidationTierConfig = {
  ageThreshold: MAJOR_CONSOLIDATION_AGE_TURNS,
  bucketSize: MAJOR_CONSOLIDATION_BUCKET_SIZE,
  importanceFilter: ['MAJOR', 'CRITICAL'],
  resultImportance: 'MAJOR',
  eventLabel: 'major events',
  stretchLabel: 'A consequential stretch',
}

/**
 * One tier's worth of the consolidation pass: query eligible rows for this
 * tier's importance filter/age threshold, group into this tier's bucket
 * width, roll each full bucket into one era-summary memory, and delete the
 * originals. Shared by both tiers in consolidateOldMemories below so the
 * query/bucket/create/delete logic can't drift between them.
 *
 * Catches its own errors (never throws) and isolated per tier on purpose:
 * the two tiers are independent DB work, so one tier's failure must not
 * discard the OTHER tier's already-real writes by forcing a shared return
 * value back to zero — that would misreport what actually happened, not
 * just fail safe.
 */
async function consolidateTier(
  campaignId: string,
  currentTurn: number,
  tier: ConsolidationTierConfig
): Promise<{ bucketsConsolidated: number; memoriesRemoved: number }> {
  try {
    return await consolidateTierUnsafe(campaignId, currentTurn, tier)
  } catch (error) {
    console.error(`Error consolidating ${tier.resultImportance}-tier campaign memories:`, error)
    return { bucketsConsolidated: 0, memoriesRemoved: 0 }
  }
}

async function consolidateTierUnsafe(
  campaignId: string,
  currentTurn: number,
  tier: ConsolidationTierConfig
): Promise<{ bucketsConsolidated: number; memoriesRemoved: number }> {
  const cutoffTurn = currentTurn - tier.ageThreshold
  if (cutoffTurn <= 0) {
    return { bucketsConsolidated: 0, memoriesRemoved: 0 }
  }

  // Column names below are quoted camelCase because that's what Prisma
  // actually created the table with (no @map on CampaignMemory's fields,
  // only @@map on the table itself) — unquoted snake_case would silently
  // target nonexistent columns.
  const eligible = await prisma.$queryRaw<EligibleMemoryRow[]>`
    SELECT
      id,
      "turnNumber" as "turnNumber",
      title,
      summary,
      "involvedCharacterIds" as "involvedCharacterIds",
      "involvedNpcIds" as "involvedNpcIds",
      "involvedFactionIds" as "involvedFactionIds",
      "locationTags" as "locationTags",
      "retrievalCount" as "retrievalCount",
      "lastRetrievedTurn" as "lastRetrievedTurn"
    FROM campaign_memories
    WHERE
      "campaignId" = ${campaignId}
      AND "turnNumber" <= ${cutoffTurn}
      AND importance = ANY(${tier.importanceFilter}::"MemoryImportance"[])
      AND NOT (${ERA_SUMMARY_TAG} = ANY(tags))
      -- #440: an already-archived memory must not be re-selected. Without
      -- this the pass re-archives its own output every run, which reset
      -- archivedAt each time — and once #442 added retention keyed on that
      -- column, a row whose clock restarts every consolidation could never
      -- age out at all. The archive would have been unbounded by a
      -- different mechanism than the one #442 closed.
      AND "archivedAt" IS NULL
      -- memory-fog-exempt: this is the maintenance pass that DECIDES what to
      -- archive, not a player-facing read. Fog-filtering it would leave
      -- memories involving undiscovered entities permanently un-archivable,
      -- which is the opposite of what this module is for. Nothing it selects
      -- reaches a prompt; it only ever writes summaries and sets archivedAt.
    ORDER BY "turnNumber" ASC
  `

  // Frequently-and-recently-retrieved memories are exempt, same idea as
  // the importance filter above but computed in app code rather than SQL
  // so the decision itself (isFrequentlyRetrieved) stays unit-testable.
  const notFrequentlyRetrieved = eligible.filter((m) => !isFrequentlyRetrieved(m, currentTurn))

  if (notFrequentlyRetrieved.length === 0) {
    return { bucketsConsolidated: 0, memoriesRemoved: 0 }
  }

  const buckets = decideConsolidationBuckets(notFrequentlyRetrieved, tier.bucketSize)

  let bucketsConsolidated = 0
  let memoriesRemoved = 0

  for (const bucket of buckets) {
    const { startTurn, endTurn, maxTurn, memories } = bucket

    // Found live-verifying #216: createCampaignMemory fails open (catches
    // its own embedding/DB error and returns rather than throwing) — the
    // original code deleted the source memories unconditionally right
    // after calling it, with no check that the replacement summary
    // actually got written. A transient embedding-API failure during
    // consolidation would silently DELETE the detailed originals while
    // the summary that was supposed to replace them never landed —
    // real, if rare, data loss. Skipping the delete (and not counting
    // this bucket) when the create fails means a bad bucket is simply
    // retried next time consolidation runs, which is safe since this
    // whole function is already documented as safe to call repeatedly.
    const created = await createCampaignMemory({
      campaignId,
      memoryType: 'WORLD_EVENT',
      sourceId: campaignId,
      turnNumber: maxTurn,
      title: `Turns ${startTurn}-${endTurn}: ${memories.length} ${tier.eventLabel}`,
      summary: `${tier.stretchLabel} (turns ${startTurn}-${endTurn}): ${memories.map((m) => m.title).join('; ')}`,
      fullContext: memories.map((m) => `- ${m.title}: ${m.summary}`).join('\n'),
      involvedCharacterIds: Array.from(new Set(memories.flatMap((m) => m.involvedCharacterIds))),
      involvedNpcIds: Array.from(new Set(memories.flatMap((m) => m.involvedNpcIds))),
      involvedFactionIds: Array.from(new Set(memories.flatMap((m) => m.involvedFactionIds))),
      locationTags: Array.from(new Set(memories.flatMap((m) => m.locationTags))),
      importance: tier.resultImportance,
      tags: [ERA_SUMMARY_TAG],
    })

    if (!created) {
      console.error(`Skipping deletion of ${memories.length} memories for campaign ${campaignId} — era-summary creation failed, will retry next consolidation pass`)
      continue
    }

    // #392: ARCHIVE, don't delete.
    //
    // This used to DELETE, which irreversibly destroyed each memory's
    // fullContext, emotionalTone, importance, memoryType, sourceId,
    // retrievalCount, tags and its own turnNumber — and unioned entity
    // attribution across the bucket, so "who was in what" became "who was
    // in this decade". None of that is derivable from the summary, which
    // is a list of headlines.
    //
    // Dropping the embedding is what the compaction was actually for: a
    // 1536-dimension vector is the bulk of the row and the only part that
    // competes in the RAG candidate pool. Nulling it removes the memory
    // from retrieval — the CTE already requires `embedding IS NOT NULL` —
    // while archivedAt makes the intent explicit for every other reader,
    // and consolidatedIntoId records where to look instead.
    const idsToArchive = memories.map((m) => m.id)
    await prisma.$executeRaw`
      UPDATE campaign_memories
         SET embedding = NULL,
             "archivedAt" = NOW(),
             "consolidatedIntoId" = ${created}
       WHERE id = ANY(${idsToArchive}::text[])
    `

    bucketsConsolidated += 1
    memoriesRemoved += memories.length
  }

  return { bucketsConsolidated, memoriesRemoved }
}

/**
 * Roll up old memories into per-era summaries — MINOR/NORMAL on the short
 * horizon, MAJOR/CRITICAL on a much longer one (#216). Safe to call
 * repeatedly — it's a no-op unless there's a full bucket of eligible
 * memories to collapse. Never throws — a consolidation failure shouldn't
 * block the world turn that called it.
 */
export async function consolidateOldMemories(
  campaignId: string,
  currentTurn: number
): Promise<{ bucketsConsolidated: number; memoriesRemoved: number }> {
  // consolidateTier already catches and fails-safe per tier — see its own
  // doc comment for why that isolation matters — so a failure in one tier
  // can never erase the other tier's real, already-applied result here.
  const minor = await consolidateTier(campaignId, currentTurn, MINOR_TIER)
  const major = await consolidateTier(campaignId, currentTurn, MAJOR_TIER)

  const bucketsConsolidated = minor.bucketsConsolidated + major.bucketsConsolidated
  const memoriesRemoved = minor.memoriesRemoved + major.memoriesRemoved

  if (bucketsConsolidated > 0) {
    console.log(`✓ Consolidated ${memoriesRemoved} memories into ${bucketsConsolidated} era summaries for campaign ${campaignId}`)
  }

  return { bucketsConsolidated, memoriesRemoved }
}
