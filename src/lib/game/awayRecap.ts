// src/lib/game/awayRecap.ts
// "While you were away" — surfaces offscreen world-turn fallout a player
// missed since they last opened the campaign lobby. Pure selection/
// formatting here; the DB query and lastViewedAt read/write live in the
// away-recap API route (mirrors buildAskGmPrompt vs answerGmQuestion).

// Below this, a recap reads as noise rather than a meaningful absence —
// nobody wants "while you were away (for 40 seconds)..." on a page refresh.
export const MIN_AWAY_MS = 60 * 60 * 1000 // 1 hour

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY

/** Pure: human-readable elapsed time, coarse enough to feel like a recap header, not a stopwatch. */
export function formatAwayDuration(ms: number): string {
  if (ms < HOUR) return 'a few minutes'
  if (ms < 2 * HOUR) return 'about an hour'
  if (ms < DAY) return `about ${Math.round(ms / HOUR)} hours`
  if (ms < 2 * DAY) return 'about a day'
  if (ms < WEEK) return `about ${Math.round(ms / DAY)} days`
  if (ms < 2 * WEEK) return 'about a week'
  if (ms < 30 * DAY) return `about ${Math.round(ms / WEEK)} weeks`
  return `about ${Math.round(ms / (30 * DAY))} months`
}

export interface RecapEventInput {
  id: string
  title: string
  summaryPublic: string | null
  turnNumber: number | null
  createdAt: Date
}

export interface AwayRecap {
  awayLabel: string
  events: Array<{ id: string; title: string; summary: string }>
}

const MAX_RECAP_EVENTS = 5

/**
 * Pure: decides whether a recap is worth showing and shapes it.
 * `events` must already be pre-filtered by the caller to this campaign's
 * fog-safe, offscreen TimelineEvents created after `lastViewedAt`.
 */
export function buildAwayRecap(
  events: RecapEventInput[],
  lastViewedAt: Date | null,
  now: Date
): AwayRecap | null {
  if (!lastViewedAt) return null // first-ever visit: nothing to have missed

  const awayMs = now.getTime() - lastViewedAt.getTime()
  if (awayMs < MIN_AWAY_MS) return null
  if (events.length === 0) return null

  const chronological = [...events].sort((a, b) => {
    const byTurn = (a.turnNumber ?? 0) - (b.turnNumber ?? 0)
    return byTurn !== 0 ? byTurn : a.createdAt.getTime() - b.createdAt.getTime()
  })

  return {
    awayLabel: formatAwayDuration(awayMs),
    events: chronological.slice(-MAX_RECAP_EVENTS).map(e => ({
      id: e.id,
      title: e.title,
      summary: e.summaryPublic || e.title,
    })),
  }
}
