// src/lib/game/worldUpdaters/timelineEvents.ts
// Domain applier for world_updates.new_timeline_events — one of the
// per-domain appliers split out of the former monolithic stateUpdater.ts.
// See README Known Bugs P1 (stateUpdater decomposition, #4/#41).

import { Prisma, EventVisibility } from '@prisma/client'
import type { WorldUpdates } from '@/lib/ai/schema'

type Db = Prisma.TransactionClient
export type TimelineEventChange = NonNullable<WorldUpdates['new_timeline_events']>[number]

export async function applyTimelineEventChanges(
  tx: Db,
  campaignId: string,
  currentTurnNumber: number,
  events: TimelineEventChange[]
): Promise<void> {
  console.log(`📜 Creating ${events.length} timeline events`)

  for (const event of events) {
    await tx.timelineEvent.create({
      data: {
        campaignId,
        turnNumber: currentTurnNumber,
        title: event.title,
        summaryPublic: event.summary_public,
        summaryGM: event.summary_gm,
        isOffscreen: event.is_offscreen,
        visibility: event.visibility.toUpperCase() as EventVisibility
      }
    })
  }
}
