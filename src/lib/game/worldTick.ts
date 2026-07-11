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

import { prisma } from '@/lib/prisma'
import { tickWeather } from './tick/weatherTick'
import { tickFactionRelationships } from './tick/relationshipTick'
import { tickFactions } from './tick/factionTick'
import { tickFactionLeadership } from './tick/leadershipTick'
import { tickWars } from './tick/warTick'
import { tickFactionAmbitions } from './tick/ambitionTick'
import { tickNpcs } from './tick/npcTick'
import { logSignificantChanges } from './tick/historyLog'
import { syncWikiEntriesForChanges } from './tick/wikiSync'
import { persistWorldEvents } from './tick/worldEventLog'
import { TickContext, TickHandler, WorldChange, WorldTickResult, PendingAmbition } from './tick/types'
import { resolveTickCaps } from './tick/caps'

// tickFactionRelationships runs BEFORE tickFactions on purpose: it reads
// each faction's goal as of the end of the previous turn and writes this
// turn's relationships from that, so tickFactions can then read a
// freshly-updated relationship for this same turn's goal reassessment
// (specifically, whether DESTABILIZE_RIVAL is reachable) without a circular
// same-turn dependency. See relationshipTick.ts for the full reasoning.
//
// tickFactionLeadership runs right after tickFactions on purpose too: if a
// faction collapsed this turn and its members just defected to a rival (see
// factionTick.ts), this same-turn pass can immediately promote a new
// leader for that rival if it doesn't already have one, instead of leaving
// it leaderless until next turn.
//
// tickWars runs after both — it reads this turn's post-drift military and
// resources for momentum/attrition, and reads relationships/territory as of
// the start of this turn (one-tick lag, same reasoning as above). It runs
// before tickFactionAmbitions so a faction that just entered a war this
// turn isn't also weighed for spawning an unrelated ambition Clock on the
// same tick. See warTick.ts for the full design.
const TICK_HANDLERS: TickHandler[] = [tickWeather, tickFactionRelationships, tickFactions, tickFactionLeadership, tickWars, tickFactionAmbitions, tickNpcs]

/**
 * Run one deterministic world tick for a campaign.
 *
 * Cadence: called once per player action (from runWorldTurn, after a scene
 * resolves) — the same cadence the rest of the world-turn system already
 * uses. There is no separate clock; this rides the existing
 * WorldMeta.currentTurnNumber progression instead of inventing a new one.
 */
export async function runWorldTick(campaignId: string, turnNumber: number): Promise<WorldTickResult> {
  const worldMeta = await prisma.worldMeta.findUnique({
    where: { campaignId },
    select: { factionCap: true, npcCap: true },
  })
  const { factionCap, npcCap } = resolveTickCaps(worldMeta)
  const ctx: TickContext = { campaignId, turnNumber, factionCap, npcCap }

  const changes: WorldChange[] = []
  const pendingAmbitions: PendingAmbition[] = []
  for (const handler of TICK_HANDLERS) {
    const result = await handler(ctx)
    changes.push(...result.changes)
    if (result.pendingAmbitions) pendingAmbitions.push(...result.pendingAmbitions)
  }

  // All three consumers fan out from the same changes array — the event-bus
  // shape, at the current scale, without a literal pub/sub mechanism.
  await persistWorldEvents(campaignId, turnNumber, changes)
  const historyEntriesCreated = await logSignificantChanges(campaignId, turnNumber, changes)
  await syncWikiEntriesForChanges(campaignId, turnNumber, changes)

  return {
    campaignId,
    turnNumber,
    timestamp: new Date(),
    changes,
    historyEntriesCreated,
    pendingAmbitions,
  }
}
