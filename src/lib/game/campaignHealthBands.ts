// src/lib/game/campaignHealthBands.ts
//
// Where "how is this campaign doing" is DEFINED.
//
// Dependency-free on purpose. The rule is needed by the scene resolver
// (server, health freshly computed), the health endpoint (server, health
// read back from WorldMeta) and the admin panel (client, rendering it) —
// and campaign-health.ts imports Prisma, so a client component cannot
// reach the rule there without dragging the database client into the
// browser bundle. Same split, for the same reason, as worldStateChanges.ts.
//
// Before this, the definition existed in three places and agreed in none:
// `isHealthy` on the monitor (>= 70 and no issues), an async
// `checkCampaignNeedsIntervention` that no one called (< 50 or 3+ issues),
// and the admin panel's own colour thresholds (>= 70 green, >= 40 amber)
// invented locally. A GM could read an amber badge on a campaign the
// engine considered to be in trouble.

/** Below this score a campaign is in trouble regardless of issue count. */
export const HEALTH_INTERVENTION_SCORE = 50

/**
 * This many distinct issues means intervention even at an acceptable
 * score — the case an average smooths away. A campaign can sit at 60 with
 * three separate things wrong with it, and that is not a healthy campaign.
 */
export const HEALTH_INTERVENTION_ISSUE_COUNT = 3

/** At or above this score, with no issues at all, a campaign is healthy. */
export const HEALTH_GOOD_SCORE = 70

export type HealthBand = 'good' | 'fair' | 'needs-intervention'

export interface HealthSummary {
  score: number | null
  issues: string[]
}

/**
 * Does the GM need to step in?
 *
 * Two triggers, not one: a low score catches slow decline, and the issue
 * count catches a campaign scoring acceptably while several distinct
 * things are wrong.
 */
export function needsIntervention(health: HealthSummary | null | undefined): boolean {
  const issues = Array.isArray(health?.issues) ? health!.issues : []
  if (issues.length >= HEALTH_INTERVENTION_ISSUE_COUNT) return true

  // An unmeasured score must not read as a crisis. Number(null) is 0 and
  // finite, which would make "never assessed" the worst possible health —
  // so null is rejected before coercion, not after.
  const raw = health?.score
  if (raw === null || raw === undefined) return false
  const score = Number(raw)
  if (!Number.isFinite(score)) return false

  return score < HEALTH_INTERVENTION_SCORE
}

/**
 * The three-band read the UI should colour from, so a badge can never
 * disagree with the engine about whether a campaign is in trouble.
 */
export function healthBand(health: HealthSummary | null | undefined): HealthBand {
  if (needsIntervention(health)) return 'needs-intervention'

  const raw = health?.score
  if (raw === null || raw === undefined) return 'fair'
  const score = Number(raw)
  if (!Number.isFinite(score)) return 'fair'

  const issues = Array.isArray(health?.issues) ? health!.issues : []
  return score >= HEALTH_GOOD_SCORE && issues.length === 0 ? 'good' : 'fair'
}
