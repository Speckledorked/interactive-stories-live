// src/lib/game/tick/pacing.ts
// World-turn pacing: the faction/NPC simulation advances with IN-GAME
// time, not per player action. Before this, runWorldTurn fired on every
// resolution — so a rapid-fire combat scene (minutes of fiction) moved
// the world as much as a week-long journey, and long scenes made factions
// sprint. Now each resolution banks the AI's time_passage into
// WorldMeta.hoursSinceWorldTurn and a world turn only runs when a full
// in-game day (default) has actually passed in the fiction.
//
// Pure decisions live here; the DB claim + runWorldTurn call is
// runWorldTurnIfDue in worldTurn.ts.

export const DEFAULT_WORLD_TURN_HOURS = 24

export function resolveWorldTurnHours(
  worldMeta: { worldTurnHours: number | null } | null
): number {
  const configured = worldMeta?.worldTurnHours
  return configured && configured > 0 ? configured : DEFAULT_WORLD_TURN_HOURS
}

/**
 * In-game hours elapsed in one AI response's time_passage. Only days/hours
 * count — a bare new_date string carries no computable duration and the
 * prompt's own examples always use days/hours.
 */
export function elapsedInGameHours(
  timePassage: { days?: number; hours?: number } | null | undefined
): number {
  if (!timePassage) return 0
  const days = Number(timePassage.days) || 0
  const hours = Number(timePassage.hours) || 0
  return Math.max(0, days * 24 + hours)
}

export interface WorldTurnPacingDecision {
  shouldRun: boolean
  // What the accumulator becomes after this decision. Banked overflow is
  // capped at one extra threshold: a month-long timeskip yields a world
  // turn now and one more next resolution, not thirty machine-gunned
  // ticks (each world turn costs AI calls, and clocks/ambitions were
  // tuned for turns arriving one at a time).
  remainingHours: number
}

export function decideWorldTurnPacing(
  accumulatedHours: number,
  thresholdHours: number
): WorldTurnPacingDecision {
  if (accumulatedHours < thresholdHours) {
    return { shouldRun: false, remainingHours: accumulatedHours }
  }
  return {
    shouldRun: true,
    remainingHours: Math.min(accumulatedHours - thresholdHours, thresholdHours),
  }
}
