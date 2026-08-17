// src/lib/game/tick/historyLog.ts
// World Sim Phase 1 — write significant tick changes into campaign history.
//
// Reuses the existing Campaign Memory / RAG system (createCampaignMemory)
// instead of a parallel history table, so world-tick events are indexed and
// retrieved exactly the same way as scene memories: embedded, searchable by
// entity ID, and pulled into the AI GM prompt via retrieveRelevantHistory.

import { createCampaignMemory, memoryDedupeKey } from '@/lib/ai/memoryCreation'
import { WorldChange, TickEntityType } from './types'
import type { SimTurn } from '@/lib/game/turnClock'

const MEMORY_TYPE_BY_ENTITY: Record<TickEntityType, 'WORLD_EVENT' | 'FACTION_EVENT' | 'LOCATION_EVENT'> = {
  NPC: 'WORLD_EVENT',
  FACTION: 'FACTION_EVENT',
  LOCATION_WEATHER: 'LOCATION_EVENT',
  LOCATION_CONDITION: 'LOCATION_EVENT',
  LOCATION_POPULATION: 'LOCATION_EVENT',
  // Integrity Engine repairs (game/integrity/) — filed as world events, same
  // as any other background correction with no more specific memory type.
  CLOCK: 'WORLD_EVENT',
  QUEST: 'WORLD_EVENT',
  WAR: 'WORLD_EVENT',
  CHARACTER: 'WORLD_EVENT',
  DEBT: 'WORLD_EVENT',
  // #175: scene-resolution location field changes — not currently routed
  // through logSignificantChanges (only persistWorldEvents), but the
  // exhaustive Record above still needs every TickEntityType covered.
  LOCATION: 'LOCATION_EVENT',
}

function memoryTypeFor(change: WorldChange): 'WORLD_EVENT' | 'FACTION_EVENT' | 'LOCATION_EVENT' | 'NPC_INTERACTION' {
  // Player-caused NPC consequences are interactions, not background world
  // events — same significance gate as ticks, just a more precise label.
  if (change.entityType === 'NPC' && change.origin === 'consequence') {
    return 'NPC_INTERACTION'
  }
  return MEMORY_TYPE_BY_ENTITY[change.entityType]
}

/**
 * Log the significant changes from a world tick (or player-action
 * consequences — see src/lib/game/consequences.ts) as campaign memories.
 * Non-significant changes (routine numeric nudges, unchanged plan text,
 * etc.) are intentionally skipped by callers before reaching here — this
 * function assumes everything it's given is worth recording.
 *
 * #236 (adversarial audit): the returned count used to be
 * `significant.length` unconditionally — every candidate counted as
 * "logged" regardless of whether `createCampaignMemory` actually
 * succeeded. That function already fails open internally (a swallowed
 * embedding-call failure returns `false` rather than throwing), so this
 * never crashed, but the count itself was silently wrong whenever an
 * embedding call failed — `historyEntriesCreated` (surfaced in
 * `worldTurn.ts`'s turn summary) overclaimed how much of the tick's
 * history actually made it into memory. Now counts real successes only.
 */
export async function logSignificantChanges(
  campaignId: string,
  // #437: the SIMULATION turn. This is the funnel every sim-clock history
  // write goes through, so branding it here is what makes a scene counter
  // reaching one of these columns a compile error rather than a silently
  // wrong row. See turnClock.ts.
  turnNumber: SimTurn,
  changes: WorldChange[]
): Promise<number> {
  const significant = changes.filter((c) => c.significant)
  let created = 0

  // #377: each of these costs a paid embedding call, and a world turn that
  // fails after this point re-runs the whole turn — so without a replay
  // key the retry re-bought every embedding it had already paid for and
  // left duplicate memories competing in the RAG candidate pool. The
  // ordinal disambiguates two significant changes that would otherwise
  // produce an identical title in one turn.
  const dedupeOrdinals = new Map<string, number>()

  for (const change of significant) {
    const title = `${change.entityName}: ${change.field} changed`
    const identity = `${change.entityId}|${title}`
    const ordinal = dedupeOrdinals.get(identity) ?? 0
    dedupeOrdinals.set(identity, ordinal + 1)

    const ok = await createCampaignMemory({
      campaignId,
      memoryType: memoryTypeFor(change),
      sourceId: change.entityId,
      turnNumber,
      dedupeKey: `${memoryDedupeKey({
        memoryType: memoryTypeFor(change),
        sourceId: change.entityId,
        turnNumber,
        title,
      })}#${ordinal}`,
      title,
      summary: change.reason,
      fullContext: change.reason,
      involvedCharacterIds: [],
      involvedNpcIds: change.entityType === 'NPC' ? [change.entityId] : [],
      involvedFactionIds: change.entityType === 'FACTION' ? [change.entityId] : [],
      locationTags: change.entityType === 'LOCATION_WEATHER' ? [change.entityName] : [],
      importance: change.importance,
      tags: [change.origin === 'consequence' ? 'player_consequence' : 'world_tick', change.entityType.toLowerCase()],
    })
    if (ok) created++
  }

  return created
}
