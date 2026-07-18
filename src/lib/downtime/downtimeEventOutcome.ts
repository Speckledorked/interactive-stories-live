// src/lib/downtime/downtimeEventOutcome.ts
// Deterministic downtime day-event outcomes (depth audit follow-up, see
// README's Known Issues).
//
// Downtime's entry costs (gold/items/favor/quest) are genuinely enforced,
// but its day-by-day events were 100% freeform AI prose: whether a day even
// had an event was a bare Math.random() < 0.4 coin flip, and the event's
// nature (does it help, hurt, or just pass the time?) was left entirely to
// the model's improvisation. This gives downtime the same "dice decide how
// well, AI decides how" backbone scene resolution already has: a
// deterministic, riskLevel-weighted roll decides whether a day has an event
// and what category it falls into BEFORE the AI is asked to narrate it —
// the AI's job becomes writing prose that fits the category, not deciding
// the day's fortune itself.

import { stableHash } from '@/lib/game/tick/types'

export type DowntimeEventOutcome = 'setback' | 'complication' | 'smooth' | 'opportunity'
export type DowntimeRiskLevel = 'low' | 'medium' | 'high'

// Same 40% chance an event happens on a given day as before — now
// deterministic (stableHash) instead of Math.random, so it's reproducible
// and testable.
const EVENT_CHANCE_PERCENT = 40

// Weights (sum to 100 per row) for which category a day's event falls
// into, once one is determined to happen at all. Higher risk activities
// skew toward setback/complication; lower risk skews toward smooth
// progress, with opportunity roughly constant — a genuinely lucky break
// can happen regardless of how risky the activity is.
const RISK_OUTCOME_WEIGHTS: Record<DowntimeRiskLevel, Record<DowntimeEventOutcome, number>> = {
  low: { setback: 5, complication: 15, smooth: 60, opportunity: 20 },
  medium: { setback: 15, complication: 30, smooth: 35, opportunity: 20 },
  high: { setback: 30, complication: 35, smooth: 20, opportunity: 15 },
}

function normalizeRisk(riskLevel: string | null | undefined): DowntimeRiskLevel {
  return riskLevel === 'low' || riskLevel === 'high' ? riskLevel : 'medium'
}

/**
 * Pure decision: which outcome category applies, given the risk level and
 * a (activityId, day) pair to seed the deterministic roll. Used both for
 * chance-gated days (decideDowntimeDayEvent below) and for guaranteed
 * initial events (see generateInitialEvents in ai-downtime-service.ts),
 * which always get an event but still deserve a real category rather than
 * defaulting to one.
 */
export function decideDowntimeOutcomeCategory(
  activityId: string,
  day: number,
  riskLevel: string | null | undefined
): DowntimeEventOutcome {
  const weights = RISK_OUTCOME_WEIGHTS[normalizeRisk(riskLevel)]
  const total = Object.values(weights).reduce((sum, w) => sum + w, 0)
  const outcomeRoll = stableHash(`${activityId}:${day}:outcome`) % total

  let cumulative = 0
  for (const outcome of Object.keys(weights) as DowntimeEventOutcome[]) {
    cumulative += weights[outcome]
    if (outcomeRoll < cumulative) {
      return outcome
    }
  }
  // Unreachable in practice (weights sum to `total` exactly), but keeps
  // the function total rather than possibly returning undefined.
  return 'smooth'
}

export interface DowntimeDayEventDecision {
  hasEvent: boolean
  outcome: DowntimeEventOutcome | null
}

/**
 * Pure decision: does this activity/day have an event, and if so, what
 * category is it? Deterministic given (activityId, day, riskLevel) — same
 * inputs always produce the same result, unlike the Math.random() this
 * replaces.
 */
export function decideDowntimeDayEvent(
  activityId: string,
  day: number,
  riskLevel: string | null | undefined
): DowntimeDayEventDecision {
  const eventRoll = stableHash(`${activityId}:${day}:event`) % 100
  if (eventRoll >= EVENT_CHANCE_PERCENT) {
    return { hasEvent: false, outcome: null }
  }
  return { hasEvent: true, outcome: decideDowntimeOutcomeCategory(activityId, day, riskLevel) }
}

/** Prompt-facing constraint text for a decided outcome category. */
export function describeOutcomeConstraint(outcome: DowntimeEventOutcome): string {
  switch (outcome) {
    case 'setback':
      return 'This event MUST be a setback — something genuinely goes wrong that costs time, resources, or standing. Do not soften this into a minor inconvenience.'
    case 'complication':
      return 'This event MUST be a complication — a real obstacle or wrinkle emerges that the character has to work around, without derailing the activity entirely.'
    case 'smooth':
      return 'This event MUST show smooth, uneventful progress — nothing dramatic happens; the activity simply advances as expected.'
    case 'opportunity':
      return 'This event MUST be a genuine opportunity — something unexpectedly favorable presents itself, beyond what the activity alone would have provided.'
  }
}
