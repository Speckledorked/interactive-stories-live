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

// ---------------------------------------------------------------------------
// #376: the world-turn lease
// ---------------------------------------------------------------------------
//
// The accumulator above CANNOT also be the mutex, and the reason is the
// overflow cap two functions up. A claim rewrites hoursSinceWorldTurn to
// `remainingHours`, and at accumulatedHours >= 2 * threshold that value is
// EXACTLY `threshold` — which still satisfies a `gte: threshold` claim
// predicate. Claimer A writes 24; claimer B matches 24 >= 24 and runs the
// same turn concurrently.
//
// That is not a narrow race window. The heartbeat sweep re-banks ~24h/day
// and the accumulator parks at exactly the threshold after every run, so an
// idle campaign sits permanently on the boundary. Two turns at the same
// simulation turn means duplicate wars, doubled belief drift (the tick
// derives drift by counting prior-turn WorldEvent rows) and two billed AI
// passes.
//
// A compare-and-set only excludes if the post-state fails the pre-state
// predicate, and "how much time carries forward" is a different question
// from "has this turn been claimed". So the claim gets its own column.
//
// A lease rather than a plain boolean because the holder can die: the cron
// sweep runs up to MAX_TURNS_PER_SWEEP turns against a maxDuration budget
// and CAN be killed mid-turn, and a boolean flag set by a killed process
// wedges that campaign forever. A lease older than the timeout below is
// treated as abandoned and may be taken over.
//
// Sized well above the worst realistic turn: TICK_TRANSACTION_TIMEOUT_MS is
// 20s for the handler pass alone, and a turn additionally makes several AI
// completions plus serial embeddings. 15 minutes is comfortably longer than
// any turn that is still alive, and short enough that a genuinely dead
// holder doesn't block the next daily sweep.
export const WORLD_TURN_LEASE_TIMEOUT_MS = 15 * 60 * 1000

/**
 * May a new run take the world-turn lease, given the currently-recorded
 * holder? Pure — the DB predicate in worldTurn.ts mirrors this exactly.
 *
 * `null` means nobody holds it. A stale lease means the previous holder
 * died without releasing.
 */
export function leaseIsAvailable(
  runningSince: Date | null | undefined,
  now: Date,
  timeoutMs: number = WORLD_TURN_LEASE_TIMEOUT_MS
): boolean {
  if (!runningSince) return true
  return now.getTime() - runningSince.getTime() >= timeoutMs
}

/**
 * The cutoff a claim query compares `worldTurnRunningSince` against: a
 * lease stamped before this instant is abandoned.
 */
export function staleLeaseCutoff(
  now: Date,
  timeoutMs: number = WORLD_TURN_LEASE_TIMEOUT_MS
): Date {
  return new Date(now.getTime() - timeoutMs)
}
