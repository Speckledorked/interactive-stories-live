/**
 * Memory Consolidation
 *
 * campaign_memories is never capped at write time (see memoryCreation.ts) —
 * nearly every tick change, scene, and offscreen event gets its own row, so a
 * long campaign accumulates far more rows than the README's own "100+ scene
 * campaign" scale target implies (several hundred to low thousands, not
 * ~100). This periodically rolls up old, low-importance memories into a
 * single per-era summary so the table stays bounded, without ever touching
 * MAJOR/CRITICAL memories — those are exactly the moments long-term recall
 * exists for and are permanently exempt.
 */

import { prisma } from '@/lib/prisma'
import { createCampaignMemory } from './memoryCreation'

const CONSOLIDATION_AGE_TURNS = 20 // only touch memories at least this many turns old
const CONSOLIDATION_BUCKET_SIZE = 10 // group eligible memories into turn-number windows this wide
const MIN_BUCKET_SIZE_TO_CONSOLIDATE = 3 // skip buckets too small to be worth collapsing
export const ERA_SUMMARY_TAG = 'era-summary' // marks a consolidated row so it's never re-consolidated

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
 * Pure grouping decision: given already-eligible (old, low-importance,
 * not-yet-consolidated) memories, group them into fixed turn-number windows
 * and drop any window too small to be worth collapsing into one row. No DB
 * access — the caller is responsible for filtering eligibility and for
 * actually writing/deleting rows.
 */
export function decideConsolidationBuckets(eligible: EligibleMemoryRow[]): ConsolidationBucket[] {
  const buckets = new Map<number, EligibleMemoryRow[]>()
  for (const memory of eligible) {
    const bucketKey = Math.floor((memory.turnNumber - 1) / CONSOLIDATION_BUCKET_SIZE)
    const bucket = buckets.get(bucketKey) || []
    bucket.push(memory)
    buckets.set(bucketKey, bucket)
  }

  const result: ConsolidationBucket[] = []
  for (const [bucketKey, memories] of buckets) {
    if (memories.length < MIN_BUCKET_SIZE_TO_CONSOLIDATE) continue
    const startTurn = bucketKey * CONSOLIDATION_BUCKET_SIZE + 1
    const endTurn = startTurn + CONSOLIDATION_BUCKET_SIZE - 1
    const maxTurn = Math.max(...memories.map((m) => m.turnNumber))
    result.push({ startTurn, endTurn, maxTurn, memories })
  }
  return result
}

/**
 * Roll up old MINOR/NORMAL memories into per-era summaries. Safe to call
 * repeatedly — it's a no-op unless there's a full bucket of eligible
 * memories to collapse.
 */
export async function consolidateOldMemories(
  campaignId: string,
  currentTurn: number
): Promise<{ bucketsConsolidated: number; memoriesRemoved: number }> {
  try {
    const cutoffTurn = currentTurn - CONSOLIDATION_AGE_TURNS
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
        AND importance IN ('MINOR', 'NORMAL')
        AND NOT (${ERA_SUMMARY_TAG} = ANY(tags))
      ORDER BY "turnNumber" ASC
    `

    // Frequently-and-recently-retrieved memories are exempt, same idea as
    // the importance filter above but computed in app code rather than SQL
    // so the decision itself (isFrequentlyRetrieved) stays unit-testable.
    const notFrequentlyRetrieved = eligible.filter((m) => !isFrequentlyRetrieved(m, currentTurn))

    if (notFrequentlyRetrieved.length === 0) {
      return { bucketsConsolidated: 0, memoriesRemoved: 0 }
    }

    const buckets = decideConsolidationBuckets(notFrequentlyRetrieved)

    let bucketsConsolidated = 0
    let memoriesRemoved = 0

    for (const bucket of buckets) {
      const { startTurn, endTurn, maxTurn, memories } = bucket

      await createCampaignMemory({
        campaignId,
        memoryType: 'WORLD_EVENT',
        sourceId: campaignId,
        turnNumber: maxTurn,
        title: `Turns ${startTurn}-${endTurn}: ${memories.length} minor events`,
        summary: `A quieter stretch (turns ${startTurn}-${endTurn}): ${memories.map((m) => m.title).join('; ')}`,
        fullContext: memories.map((m) => `- ${m.title}: ${m.summary}`).join('\n'),
        involvedCharacterIds: Array.from(new Set(memories.flatMap((m) => m.involvedCharacterIds))),
        involvedNpcIds: Array.from(new Set(memories.flatMap((m) => m.involvedNpcIds))),
        involvedFactionIds: Array.from(new Set(memories.flatMap((m) => m.involvedFactionIds))),
        locationTags: Array.from(new Set(memories.flatMap((m) => m.locationTags))),
        importance: 'NORMAL',
        tags: [ERA_SUMMARY_TAG],
      })

      const idsToDelete = memories.map((m) => m.id)
      await prisma.$executeRaw`
        DELETE FROM campaign_memories WHERE id = ANY(${idsToDelete}::text[])
      `

      bucketsConsolidated += 1
      memoriesRemoved += memories.length
    }

    if (bucketsConsolidated > 0) {
      console.log(`✓ Consolidated ${memoriesRemoved} memories into ${bucketsConsolidated} era summaries for campaign ${campaignId}`)
    }

    return { bucketsConsolidated, memoriesRemoved }
  } catch (error) {
    console.error('Error consolidating campaign memories:', error)
    // Don't throw — consolidation failures shouldn't block the world turn
    return { bucketsConsolidated: 0, memoriesRemoved: 0 }
  }
}
