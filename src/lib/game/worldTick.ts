// src/lib/game/worldTick.ts
// World Sim Phase 1 — the deterministic world tick.
//
// This is the single entry point every simulation system hooks into. It is
// pure and deterministic: it decides WHAT changed and WHY, then returns a
// structured list of changes. It never calls the AI. Narration of these
// changes into prose is entirely the job of the existing AI GM code
// (generateOffscreenEvents in worldTurn.ts, and the prompt builder in
// src/lib/ai/worldState.ts) — the AI narrates, the tick simulates. Keeping
// that boundary strict is the entire point of this system.
//
// Phase 2+ features (rumors, economy, ecology, ...) plug in by adding
// another handler to TICK_HANDLERS below. Nothing else about this file
// needs to change for that to work.

import { tickWeather } from './tick/weatherTick'
import { tickFactions } from './tick/factionTick'
import { tickNpcs } from './tick/npcTick'
import { logSignificantChanges } from './tick/historyLog'
import { syncWikiEntriesForChanges } from './tick/wikiSync'
import { TickContext, TickHandler, WorldChange, WorldTickResult } from './tick/types'

const TICK_HANDLERS: TickHandler[] = [tickWeather, tickFactions, tickNpcs]

/**
 * Run one deterministic world tick for a campaign.
 *
 * Cadence: called once per player action (from runWorldTurn, after a scene
 * resolves) — the same cadence the rest of the world-turn system already
 * uses. There is no separate clock; this rides the existing
 * WorldMeta.currentTurnNumber progression instead of inventing a new one.
 */
export async function runWorldTick(campaignId: string, turnNumber: number): Promise<WorldTickResult> {
  const ctx: TickContext = { campaignId, turnNumber }

  const changes: WorldChange[] = []
  for (const handler of TICK_HANDLERS) {
    const result = await handler(ctx)
    changes.push(...result.changes)
  }

  const historyEntriesCreated = await logSignificantChanges(campaignId, turnNumber, changes)
  await syncWikiEntriesForChanges(campaignId, turnNumber, changes)

  return {
    campaignId,
    turnNumber,
    timestamp: new Date(),
    changes,
    historyEntriesCreated,
  }
}
