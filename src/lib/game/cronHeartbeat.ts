// src/lib/game/cronHeartbeat.ts
// Real-time pacing backstop for the world tick (see WorldMeta.lastRealTimeTickAt).
// Play itself banks in-game hours from the AI's reported time_passage each
// resolution — but a campaign nobody visits has nothing banking for it, so
// its world-turn accumulator freezes at whatever it was when everyone
// left. This banks REAL elapsed hours at a 1:1 rate on top of that,
// so the simulation still eventually crosses the world-turn threshold on
// its own. Pure; the DB read/write lives in worldTurnSweep.ts.

const REAL_HOURS_TO_IN_GAME_HOURS = 1 // 1 in-game hour banked per real hour elapsed

/**
 * How many in-game hours to bank for a campaign given when it was last
 * swept. Null (never swept before) banks nothing — there's no backlog to
 * make up for time before the cron existed, and banking a huge one-time
 * jump on first sweep would fire an unearned world turn.
 */
export function computeHeartbeatBankedHours(
  lastRealTimeTickAt: Date | null,
  now: Date
): number {
  if (!lastRealTimeTickAt) return 0
  const elapsedMs = now.getTime() - lastRealTimeTickAt.getTime()
  if (elapsedMs <= 0) return 0
  const elapsedHours = elapsedMs / (1000 * 60 * 60)
  return elapsedHours * REAL_HOURS_TO_IN_GAME_HOURS
}
