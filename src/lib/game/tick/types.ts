// src/lib/game/tick/types.ts
// World Sim Phase 1 — shared types for the deterministic world tick.
//
// Tick handlers decide WHAT changed and WHY. They never call the AI — that's
// the job of the existing narration layer (worldTurn.ts's offscreen event
// generation, and the AI GM prompt builder in worldState.ts). Handlers read
// DB state, compute new state with a pure function, persist it, and report
// back a list of WorldChange entries so the engine can log the significant
// ones to campaign history.

export type TickEntityType = 'NPC' | 'FACTION' | 'LOCATION_WEATHER'

export interface WorldChange {
  entityType: TickEntityType
  entityId: string
  entityName: string
  campaignId: string
  field: string
  previousValue: string | number
  newValue: string | number
  reason: string
  /** Whether this change is worth a history/RAG entry, vs. routine tick noise. */
  significant: boolean
  /** Importance to use if this change is logged to campaign history. */
  importance: 'NORMAL' | 'MAJOR'
  /**
   * Where this change came from. Defaults to the autonomous world tick when
   * omitted. 'consequence' changes are player-caused (see src/lib/game/consequences.ts)
   * and get tagged with a more precise memory type (NPC_INTERACTION instead
   * of WORLD_EVENT) — same significance gating either way, just a more
   * accurate label once it's already past that gate.
   */
  origin?: 'tick' | 'consequence'
}

export interface TickContext {
  campaignId: string
  turnNumber: number
}

/**
 * A faction has deterministically earned a major ambition this tick (see
 * ambitionTick.ts) but the specific flavor of it is left to the offscreen
 * AI narration path — the tick decides WHETHER, not WHAT. fallbackName/
 * fallbackConsequence/maxTicks/category are used verbatim if the AI call
 * fails or doesn't address this faction, so an ambition never silently
 * goes nowhere.
 */
export interface PendingAmbition {
  factionId: string
  factionName: string
  goal: string
  maxTicks: number
  category: string
  fallbackName: string
  fallbackConsequence: string
}

export interface TickHandlerResult {
  changes: WorldChange[]
  pendingAmbitions?: PendingAmbition[]
}

/**
 * A tick handler simulates one slice of the world (NPCs, factions, weather,
 * and — in Phase 2+ — rumors, economy, etc.) for a single campaign tick.
 * New handlers register in worldTick.ts's handler list; runWorldTick itself
 * never needs to change to support them.
 */
export type TickHandler = (ctx: TickContext) => Promise<TickHandlerResult>

export interface WorldTickResult {
  campaignId: string
  turnNumber: number
  timestamp: Date
  changes: WorldChange[]
  historyEntriesCreated: number
  pendingAmbitions: PendingAmbition[]
}

/**
 * Deterministic pseudo-variety helper. NOT a random number generator —
 * same inputs always produce the same output, so tick behavior stays
 * reproducible and testable. Used to give entities varied-but-stable
 * schedules without Math.random().
 */
export function stableHash(input: string): number {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
