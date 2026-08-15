// src/lib/game/entityStats.ts
//
// The live numbers behind a /world entity card.
//
// The World browser exists to show entities the simulation rewrites every
// turn, but its cards were rendering the same prose summary the Codex
// does — so a faction that had just lost a war looked identical to one
// winning it. These are the fields the tick actually moves, shaped for
// display and nothing else.
//
// Everything here is pure and side-effect free: the route builds these
// objects from rows it has already fog-of-war filtered, and the component
// renders them. No query, no formatting of anything it wasn't handed.
//
// On the numbers-vs-labels question, this splits deliberately from
// npcRelationship.ts. That helper returns labels ONLY, because a player
// knowing an NPC's exact affection integer is a fiction leak — those are
// someone's private feelings. A faction's threat level and a location's
// condition are public, observable facts about the world, and the admin
// panel already shows them numerically. So these carry the raw value AND
// a band label: the meter needs the number, the screen reader needs the
// word.

export type FactionStats = {
  kind: 'FACTION'
  /** 1-5, clamped everywhere it's written (see ambitionResolution.ts). */
  threatLevel: number
  /** 0-100. */
  stability: number
  /** 0-100. */
  influence: number
  /** 0-100. */
  military: number
  isActive: boolean
}

export type LocationStats = {
  kind: 'LOCATION'
  /** 0-100, DB-constrained (Location_conditionScore_range). */
  conditionScore: number
  /** Closed vocabulary from deriveConditionTags. */
  conditionTags: string[]
  weather: string
  /** 1 (mild) - 5 (extreme). */
  weatherSeverity: number
}

export type ClockStats = {
  kind: 'CLOCK'
  currentTicks: number
  maxTicks: number
  category: string | null
}

export type EntityStats = FactionStats | LocationStats | ClockStats

export const THREAT_MIN = 1
export const THREAT_MAX = 5

/**
 * Diegetic band for a 1-5 threat level. Out-of-range values are clamped
 * rather than returning undefined — this renders a card, and a card that
 * throws because a migration widened a range is worse than one that
 * rounds to the nearest band.
 */
export function describeThreat(level: number): string {
  const n = Math.min(Math.max(Math.round(level), THREAT_MIN), THREAT_MAX)
  return (['Dormant', 'Watchful', 'Active', 'Dangerous', 'Dire'] as const)[n - 1]
}

/** Diegetic band for a 0-100 stability score. */
export function describeStability(score: number): string {
  if (score < 25) return 'Crumbling'
  if (score < 50) return 'Strained'
  if (score < 75) return 'Steady'
  return 'Entrenched'
}

/**
 * Tone for a stability meter — low stability is bad, so this inverts
 * relative to a plain progress bar.
 */
export function stabilityTone(score: number): 'danger' | 'warn' | 'good' {
  if (score < 25) return 'danger'
  if (score < 50) return 'warn'
  return 'good'
}

/** Tone for a threat meter — high threat is bad. */
export function threatTone(level: number): 'good' | 'warn' | 'danger' {
  if (level >= 4) return 'danger'
  if (level >= 3) return 'warn'
  return 'good'
}

/**
 * `STORM` -> `Storm`. The enum is the source of truth, so this formats
 * whatever it's given rather than mapping a fixed list that would silently
 * drop a newly added condition.
 */
export function describeWeather(weather: string, severity: number): string {
  const label = weather.charAt(0) + weather.slice(1).toLowerCase()
  if (severity >= 4) return `${label} (severe)`
  return label
}

/** Human-readable condition band, taken from the tag vocabulary itself. */
export function describeConditionTag(tag: string): string {
  return tag.charAt(0) + tag.slice(1).toLowerCase()
}
