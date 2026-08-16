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

/**
 * #377: the replay identity for one change.
 *
 * A world turn spans ~14 commit boundaries, so a failure partway through
 * re-runs the WHOLE turn at the same turn number. Before this, that retry
 * wrote ~40 duplicate rows — and the duplicates are not inert, because
 * beliefTick/npcDispositionTick derive drift by COUNTING prior-turn rows.
 * A retry silently doubled the drift it fed back into the simulation.
 *
 * The key has to be stable across a replay and distinct between two
 * genuinely different writes. Turn + entity + field + before→after covers
 * the first; the ordinal covers the second, because two handlers really can
 * touch the same field in one turn (seasonTick and economyTick both nudge
 * faction.resources) and those must not collapse into one row. The tick is
 * deterministic, so a replay produces the same change list in the same
 * order and therefore the same ordinals.
 */
export function worldEventDedupeKeys(turnNumber: number, changes: WorldChange[]): string[] {
  const seen = new Map<string, number>()
  return changes.map((change) => {
    const identity = [
      turnNumber,
      typeFor(change),
      change.entityId,
      change.field,
      String(change.previousValue),
      String(change.newValue),
    ].join('|')
    const ordinal = seen.get(identity) ?? 0
    seen.set(identity, ordinal + 1)
    return `${identity}#${ordinal}`
  })
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

  const dedupeKeys = worldEventDedupeKeys(turnNumber, changes)

  try {
    const events = await prisma.worldEvent.createManyAndReturn({
      // #377: a replayed turn re-offers rows it already wrote; the unique
      // index on (campaignId, dedupeKey) turns those into no-ops instead
      // of duplicates. Genuinely new rows in the same batch still land.
      skipDuplicates: true,
      data: changes.map((change, i) => ({
        campaignId,
        turnNumber,
        dedupeKey: dedupeKeys[i],
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

    // skipDuplicates makes createManyAndReturn return only the rows it
    // actually inserted, but this function's contract is "the events for
    // this batch" — #101's WITNESSED path needs ids for every significant
    // change so it can attach EventWitness rows. On a replay that skipped
    // some rows, the caller still has to see them: the original attempt
    // may well have died BETWEEN writing the events and writing their
    // witnesses, which is exactly the partial state the replay exists to
    // finish. Read back whatever was skipped.
    if (events.length < changes.length) {
      const existing = await prisma.worldEvent.findMany({
        where: {
          campaignId,
          dedupeKey: { in: dedupeKeys },
          id: { notIn: events.map((e) => e.id) },
        },
        select: { id: true, significant: true },
      })
      console.log(`  ↩️  ${existing.length} world event(s) already recorded for turn ${turnNumber} — replay, not duplicated`)
      return { count: events.length, events: [...events, ...existing] }
    }

    return { count: events.length, events }
  } catch (error) {
    console.error('⚠️ Failed to persist world events (non-critical):', error)
    return { count: 0, events: [] }
  }
}
