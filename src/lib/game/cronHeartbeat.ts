// src/lib/game/cronHeartbeat.ts
// Real-time pacing backstop for the world tick (see WorldMeta.lastRealTimeTickAt).
// Play itself banks in-game hours from the AI's reported time_passage each
// resolution — but a campaign nobody visits has nothing banking for it, so
// its world-turn accumulator freezes at whatever it was when everyone
// left. This is a pure idle backstop, not an add-on to active play: it
// tops the accumulator up to real elapsed time, banking only the GAP
// between real hours passed and what play already banked since the last
// sweep. A quiet campaign gets real time banked outright; an
// actively-played one gets nothing extra once play has already kept pace
// with (or outrun) the real clock. Pure; the DB read/write lives in
// worldTurnSweep.ts.

const REAL_HOURS_TO_IN_GAME_HOURS = 1 // 1 in-game hour of "idle passage" per real hour elapsed

/**
 * How many in-game hours to bank for a campaign given when it was last
 * swept and how many hours play itself already banked since then. Null
 * (never swept before) banks nothing — there's no backlog to make up for
 * time before the cron existed, and banking a huge one-time jump on first
 * sweep would fire an unearned world turn.
 */
export function computeHeartbeatBankedHours(
  lastRealTimeTickAt: Date | null,
  now: Date,
  hoursBankedSincePreviousTick: number = 0
): number {
  if (!lastRealTimeTickAt) return 0
  const elapsedMs = now.getTime() - lastRealTimeTickAt.getTime()
  if (elapsedMs <= 0) return 0
  const elapsedHours = elapsedMs / (1000 * 60 * 60)
  const idleTarget = elapsedHours * REAL_HOURS_TO_IN_GAME_HOURS
  return Math.max(0, idleTarget - hoursBankedSincePreviousTick)
}
