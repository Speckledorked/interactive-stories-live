// src/lib/game/tick/historyLog.ts
// World Sim Phase 1 — write significant tick changes into campaign history.
//
// Reuses the existing Campaign Memory / RAG system (createCampaignMemory)
// instead of a parallel history table, so world-tick events are indexed and
// retrieved exactly the same way as scene memories: embedded, searchable by
// entity ID, and pulled into the AI GM prompt via retrieveRelevantHistory.

import { createCampaignMemory } from '@/lib/ai/memoryCreation'
import { WorldChange, TickEntityType } from './types'

const MEMORY_TYPE_BY_ENTITY: Record<TickEntityType, 'WORLD_EVENT' | 'FACTION_EVENT' | 'LOCATION_EVENT'> = {
  NPC: 'WORLD_EVENT',
  FACTION: 'FACTION_EVENT',
  LOCATION_WEATHER: 'LOCATION_EVENT',
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
 */
export async function logSignificantChanges(
  campaignId: string,
  turnNumber: number,
  changes: WorldChange[]
): Promise<number> {
  const significant = changes.filter((c) => c.significant)

  for (const change of significant) {
    await createCampaignMemory({
      campaignId,
      memoryType: memoryTypeFor(change),
      sourceId: change.entityId,
      turnNumber,
      title: `${change.entityName}: ${change.field} changed`,
      summary: change.reason,
      fullContext: change.reason,
      involvedCharacterIds: [],
      involvedNpcIds: change.entityType === 'NPC' ? [change.entityId] : [],
      involvedFactionIds: change.entityType === 'FACTION' ? [change.entityId] : [],
      locationTags: change.entityType === 'LOCATION_WEATHER' ? [change.entityName] : [],
      importance: change.importance,
      tags: [change.origin === 'consequence' ? 'player_consequence' : 'world_tick', change.entityType.toLowerCase()],
    })
  }

  return significant.length
}
