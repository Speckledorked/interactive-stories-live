// src/lib/game/tick/simulationClock.ts
// #374: the one place anything asks "which simulation turn is it?"
//
// This codebase has four distinct things called "a turn" and, before this,
// one variable holding them:
//
//   1. WorldMeta.currentTurnNumber  — how many PLAYER SCENES have resolved.
//                                     Written only by sceneResolver.ts.
//   2. WorldMeta.simulationTurn     — how many WORLD TURNS have run.
//                                     Written only by worldTick.ts.
//   3. WorldMeta.hoursSinceWorldTurn— banked in-game hours (tick/pacing.ts).
//   4. totalElapsedGameHours        — the in-fiction calendar (calendar.ts).
//
// Every tick handler reasons about elapsed simulation time: information
// latency (age = currentTurn - event.turnNumber), loan maturity, war
// duration, goal commitment windows, drift watermarks. All of that is (2).
// It used to read (1), which does not move at all unless a player is
// playing — so the simulation's own arithmetic was frozen for exactly the
// campaigns the background simulation exists to serve.
//
// WorldEvent.turnNumber has to be stamped on the SAME clock by every
// writer, or the age arithmetic reads two different units out of one
// column. Scene-driven world events (stateUpdater.ts, consequences.ts)
// therefore stamp the simulation turn too — several scenes resolving
// between two world turns all legitimately happened "during" the same
// simulation turn.

import { prisma } from '@/lib/prisma'

/**
 * The simulation turn a world event happening *right now* belongs to.
 *
 * Returns 0 for a campaign with no WorldMeta row (test fixtures, and
 * campaigns mid-creation) — the same "nothing has happened yet" value the
 * column defaults to, so age arithmetic sees a zero-length history rather
 * than a negative one.
 */
export async function currentSimulationTurn(campaignId: string): Promise<number> {
  const meta = await prisma.worldMeta.findUnique({
    where: { campaignId },
    select: { simulationTurn: true },
  })
  return meta?.simulationTurn ?? 0
}
