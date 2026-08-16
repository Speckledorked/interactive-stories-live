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
// On the numbers-vs-labels question, this originally split deliberately
// from npcRelationship.ts: that helper returns labels ONLY, because a
// player knowing an NPC's exact affection integer is a fiction leak, while
// a faction's threat level and a location's condition read as public,
// observable facts.
//
// #389: that reasoning does not survive contact with the rest of the
// codebase. Every OTHER player-facing surface bands these same fields —
// wikiSync.ts:222 does it precisely so "the wiki can't hand players a
// precision the AI itself is never allowed to narrate with",
// entitySummaries.ts:37 does it, and worldSummaryMappers.ts:191 does it
// for the GM MODEL. Shipping raw integers here gave players precision the
// narrator is explicitly denied, which is not a defensible split; it is
// one surface disagreeing with three.
//
// So the payload is now role-aware. An ADMIN gets the raw values (the
// admin panel already shows them, and debugging the simulation needs
// them). A PLAYER gets the band, plus a meter position derived FROM the
// band rather than from the value — the meter still renders, at the
// granularity the fiction actually supports.
//
// Fog of war has two independent properties: WHICH entities you may see,
// and HOW EXACTLY you may see them. Only the first had a structural guard
// (fogOfWar.test.ts checks queries go through visibleTo), which is why a
// route that correctly adopted the guarded pattern for visibility
// silently violated precision.

export type FactionStats = {
  kind: 'FACTION'
  /** 1-5, clamped everywhere it's written (see ambitionResolution.ts). */
  threatLevel: number
  /** 0-100. */
  stability: number
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

// ---------------------------------------------------------------------------
// #389: precision banding for player-facing payloads
// ---------------------------------------------------------------------------
//
// The band labels above are already the vocabulary a player is allowed.
// These snap the underlying VALUE to the midpoint of its own band, so the
// meter still has something to render and the exact figure never leaves
// the server for a PLAYER-role caller.
//
// Snapping rather than omitting the number keeps the component honest
// (a meter with no value is a meter that renders wrong) without letting
// the payload — or aria-valuenow, which announces it verbatim to a screen
// reader — carry a precision the narrator itself is denied.

/** Midpoint of the 0-100 stability band a score falls in. */
export function bandedStability(score: number): number {
  if (score < 25) return 12
  if (score < 50) return 37
  if (score < 75) return 62
  return 87
}

/** Midpoint of the 0-100 condition band a score falls in — same bands. */
export const bandedCondition = bandedStability

/**
 * Threat is already a 1-5 ordinal with a label per step, so there is no
 * finer precision to lose. Clamped for the same reason describeThreat
 * clamps: a widened range should round, not throw.
 */
export function bandedThreat(level: number): number {
  return Math.min(Math.max(Math.round(level), THREAT_MIN), THREAT_MAX)
}

/**
 * Build the FACTION card payload for a given role.
 *
 * ADMIN sees the simulation as it is. PLAYER sees the fiction.
 */
export function factionStatsFor(
  role: 'ADMIN' | 'PLAYER',
  faction: { threatLevel: number; stability: number; isActive: boolean }
): FactionStats {
  return {
    kind: 'FACTION',
    threatLevel: role === 'ADMIN' ? faction.threatLevel : bandedThreat(faction.threatLevel),
    stability: role === 'ADMIN' ? faction.stability : bandedStability(faction.stability),
    isActive: faction.isActive,
  }
}

/** The LOCATION counterpart. weatherSeverity is a 1-5 ordinal like threat. */
export function locationStatsFor(
  role: 'ADMIN' | 'PLAYER',
  location: { conditionScore: number; conditionTags: string[]; weather: string; weatherSeverity: number }
): LocationStats {
  return {
    kind: 'LOCATION',
    conditionScore: role === 'ADMIN' ? location.conditionScore : bandedCondition(location.conditionScore),
    conditionTags: location.conditionTags,
    weather: location.weather,
    weatherSeverity: location.weatherSeverity,
  }
}
