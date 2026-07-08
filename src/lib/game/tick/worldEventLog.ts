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
  return change.origin === 'consequence' ? 'PLAYER' : 'SYSTEM'
}

function typeFor(change: WorldChange): string {
  return `${change.entityType.toLowerCase()}.${change.field}`
}

/**
 * Persist a batch of WorldChanges as WorldEvent rows. Best-effort — a
 * failure here shouldn't take down tick processing or scene resolution,
 * since the memory/wiki writes (the parts players actually see) already ran
 * independently of this.
 */
export async function persistWorldEvents(
  campaignId: string,
  turnNumber: number,
  changes: WorldChange[]
): Promise<number> {
  if (changes.length === 0) return 0

  try {
    const result = await prisma.worldEvent.createMany({
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
      })),
    })

    return result.count
  } catch (error) {
    console.error('⚠️ Failed to persist world events (non-critical):', error)
    return 0
  }
}
