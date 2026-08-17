// src/lib/game/worldUpdaters/timelineEvents.ts
// Domain applier for world_updates.new_timeline_events — one of the
// per-domain appliers split out of the former monolithic stateUpdater.ts.
// See #4/#41 (stateUpdater decomposition).

import { Prisma, EventVisibility } from '@prisma/client'
import type { WorldUpdates } from '@/lib/ai/schema'
import type { SimTurn } from '@/lib/game/turnClock'

type Db = Prisma.TransactionClient
export type TimelineEventChange = NonNullable<WorldUpdates['new_timeline_events']>[number]

export async function applyTimelineEventChanges(
  tx: Db,
  campaignId: string,
  // #437: TimelineEvent.turnNumber is a sim-clock column — see turnClock.ts.
  simulationTurn: SimTurn,
  events: TimelineEventChange[],
  inGameDayNumber?: number
): Promise<void> {
  console.log(`📜 Creating ${events.length} timeline events`)

  for (const event of events) {
    await tx.timelineEvent.create({
      data: {
        campaignId,
        turnNumber: simulationTurn,
        title: event.title,
        summaryPublic: event.summary_public,
        summaryGM: event.summary_gm,
        isOffscreen: event.is_offscreen,
        visibility: event.visibility.toUpperCase() as EventVisibility,
        inGameDayNumber
      }
    })
  }
}
