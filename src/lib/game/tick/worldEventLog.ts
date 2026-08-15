// src/lib/game/tick/worldEventLog.ts
// World Sim — persist every tick/consequence change as a WorldEvent row.
//
// This is the durable event stream. Unlike logSignificantChanges (which only
// writes .significant changes into CampaignMemory, because each of those
// writes costs an embedding call) and syncWikiEntriesForChanges (same gate,
// different consumer), this writes EVERY change — routine numeric nudges
// included — because a plain DB insert is cheap and a complete history is
// the entire point of an event log. Future systems (rumors, economy,
// analytics, recaps) should read from this table instead of coupling
// directly to the tick/consequence code that produced the events.

import { prisma } from '@/lib/prisma'
import type { WorldEventActorType, WorldEventTargetType } from '@prisma/client'
import { WorldChange } from './types'

function actorTypeFor(change: WorldChange): WorldEventActorType {
  // 'sceneResolution' (#175) is the main per-exchange AI GM path — every
  // bit as player-caused as 'consequence', just a different pipeline.
  return change.origin === 'consequence' || change.origin === 'sceneResolution' ? 'PLAYER' : 'SYSTEM'
}

function typeFor(change: WorldChange): string {
  return `${change.entityType.toLowerCase()}.${change.field}`
}

/** The subset of a persisted WorldEvent row callers actually need back —
 * #101's WITNESSED write path needs the real ids (createMany alone never
 * returns rows) to attach EventWitness records to the events a scene's
 * changes just produced, and only cares about the ones that were
 * significant (the same gate CampaignMemory/WikiEntry already use). */
export interface PersistedWorldEvent {
  id: string
  significant: boolean
}

/**
 * Persist a batch of WorldChanges as WorldEvent rows. Best-effort — a
 * failure here shouldn't take down tick processing or scene resolution.
 * Called sequentially before the memory/wiki writes (worldTick.ts), each
 * of which is independently caught at its own call site (#236) so a
 * failure in any one of the three doesn't prevent the others from running.
 */
export async function persistWorldEvents(
  campaignId: string,
  turnNumber: number,
  changes: WorldChange[]
): Promise<{ count: number; events: PersistedWorldEvent[] }> {
  if (changes.length === 0) return { count: 0, events: [] }

  try {
    const events = await prisma.worldEvent.createManyAndReturn({
      data: changes.map((change) => ({
        campaignId,
        turnNumber,
        type: typeFor(change),
        origin: change.origin ?? 'tick',
        actorType: actorTypeFor(change),
        targetType: change.entityType as WorldEventTargetType,
        targetId: change.entityId,
        targetName: change.entityName,
        field: change.field,
        previousValue: String(change.previousValue),
        newValue: String(change.newValue),
        reason: change.reason,
        significant: change.significant,
        importance: change.importance,
        checkKey: change.checkKey ?? null,
        wakeSourceType: change.wakeSourceType ?? null,
        originLocationId: change.originLocationId ?? null,
      })),
      select: { id: true, significant: true },
    })

    return { count: events.length, events }
  } catch (error) {
    console.error('⚠️ Failed to persist world events (non-critical):', error)
    return { count: 0, events: [] }
  }
}
