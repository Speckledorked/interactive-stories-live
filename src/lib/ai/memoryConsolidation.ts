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

export interface EligibleMemoryRow {
  id: string
  turnNumber: number
  title: string
  summary: string
  involvedCharacterIds: string[]
  involvedNpcIds: string[]
  involvedFactionIds: string[]
  locationTags: string[]
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

    const eligible = await prisma.$queryRaw<EligibleMemoryRow[]>`
      SELECT
        id,
        turn_number as "turnNumber",
        title,
        summary,
        involved_character_ids as "involvedCharacterIds",
        involved_npc_ids as "involvedNpcIds",
        involved_faction_ids as "involvedFactionIds",
        location_tags as "locationTags"
      FROM campaign_memories
      WHERE
        campaign_id = ${campaignId}
        AND turn_number <= ${cutoffTurn}
        AND importance IN ('MINOR', 'NORMAL')
        AND NOT (${ERA_SUMMARY_TAG} = ANY(tags))
      ORDER BY turn_number ASC
    `

    if (eligible.length === 0) {
      return { bucketsConsolidated: 0, memoriesRemoved: 0 }
    }

    const buckets = decideConsolidationBuckets(eligible)

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
