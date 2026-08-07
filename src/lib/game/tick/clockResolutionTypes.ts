// src/lib/game/tick/clockResolutionTypes.ts
// Shared shape between lib/ai/clockResolutionEffects.ts (generates it) and
// tick/clockResolutionEffects.ts (applies it) — kept standalone so the
// AI-calling module doesn't need to import from lib/game/tick's apply
// layer, and the apply layer's orchestrator (which itself calls into
// lib/ai) doesn't create an import cycle back the other way. Same reason
// chronicleTypes.ts exists as its own file rather than living in either
// chronicleNarration.ts or chronicleContext.ts.

export type ClockResolutionEffectType = 'SPAWN_CLOCK' | 'LOCATION_EFFECT' | 'FACTION_EFFECT'

// Blast-radius cap: one completed clock can propose at most this many
// downstream effects. Mirrors the Integrity Engine's own per-pass repair
// caps — bounding how far a single event can cascade, not just bounding
// each individual delta.
export const MAX_EFFECTS_PER_CLOCK = 2

export const SPAWN_CLOCK_MIN_TICKS = 3
export const SPAWN_CLOCK_MAX_TICKS = 8

// Magnitude bounds matched to what a real ambition resolution already
// applies (ambitionTick.ts's decideAmbitionOutcome tops out around ±10 for
// resources/stability/military, ±1 for the 1-5 threatLevel scale) — a
// single clock's completion shouldn't be allowed to swing a faction
// further than a whole faction-driven ambition arc already can.
export const MAX_FACTION_STAT_DELTA = 10
export const MAX_THREAT_LEVEL_DELTA = 1

// locationConditionTick.ts's own per-tick war damage caps at -8; this is a
// one-time discrete narrative beat rather than routine drift, so it gets a
// somewhat wider (but still bounded) allowance.
export const MAX_LOCATION_CONDITION_DELTA = 15

export interface ClockResolutionEffect {
  type: ClockResolutionEffectType
  reason: string
  // SPAWN_CLOCK
  name?: string
  maxTicks?: number
  consequence?: string
  category?: string | null
  // LOCATION_EFFECT
  targetLocationName?: string
  conditionDelta?: number
  // FACTION_EFFECT
  targetFactionName?: string
  resourceDelta?: number
  stabilityDelta?: number
  militaryDelta?: number
  threatLevelDelta?: number
}
