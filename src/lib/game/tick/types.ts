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
}

export interface TickContext {
  campaignId: string
  turnNumber: number
}

export interface TickHandlerResult {
  changes: WorldChange[]
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
