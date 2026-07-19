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

// A scene can narrate a long rest or a multi-day journey inline, but a
// genuine weeks/months skip belongs to the dedicated downtime system
// (lib/downtime/ai-downtime-service.ts, which resolves up to 365 days
// day-by-day with real events/costs/outcomes instead of one freeform
// number). This is a backstop against a single scene's time_passage being
// absurdly large — a misjudged narrative beat or an outright hallucinated
// number — not a design ceiling on how much time a campaign can cover;
// the accumulator this feeds (WorldMeta.hoursSinceWorldTurn) can still
// legitimately grow past this over many turns, same as it always could.
export const MAX_TIME_PASSAGE_HOURS_PER_SCENE = 14 * 24 // 336 hours

/**
 * In-game hours elapsed in one AI response's time_passage, clamped to
 * MAX_TIME_PASSAGE_HOURS_PER_SCENE. Only days/hours count — a bare
 * new_date string carries no computable duration and the prompt's own
 * examples always use days/hours (see time_passage's doc comment in
 * lib/ai/client.ts for why new_date isn't read at all).
 */
export function elapsedInGameHours(
  timePassage: { days?: number; hours?: number } | null | undefined
): number {
  if (!timePassage) return 0
  const days = Number(timePassage.days) || 0
  const hours = Number(timePassage.hours) || 0
  const raw = Math.max(0, days * 24 + hours)
  return Math.min(raw, MAX_TIME_PASSAGE_HOURS_PER_SCENE)
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
