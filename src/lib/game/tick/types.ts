// src/lib/game/tick/types.ts
// World Sim Phase 1 — shared types for the deterministic world tick.
//
// Tick handlers decide WHAT changed and WHY. They never call the AI — that's
// the job of the existing narration layer (worldTurn.ts's offscreen event
// generation, and the AI GM prompt builder in worldState.ts). Handlers read
// DB state, compute new state with a pure function, persist it, and report
// back a list of WorldChange entries so the engine can log the significant
// ones to campaign history.

import type { Prisma, PrismaClient } from '@prisma/client'
import type { Season } from '../calendar'

export type TickEntityType = 'NPC' | 'FACTION' | 'LOCATION_WEATHER' | 'LOCATION_CONDITION' | 'LOCATION_POPULATION' | 'CLOCK' | 'QUEST' | 'WAR' | 'CHARACTER' | 'DEBT' | 'LOCATION'

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
   * accurate label once it's already past that gate. 'integrity' changes
   * come from game/integrity/'s auto-repair, tagged with checkKey below so
   * they're distinguishable from an ordinary write to the same field.
   * 'wake' changes (#103) come from tick/wakeTick.ts's institutional-memory
   * ripple — reuses entityType 'FACTION' rather than adding a new
   * TickEntityType, so this tag is what actually distinguishes a wake
   * stability hit from an ordinary one. 'clockResolution' changes come
   * from tick/clockResolutionEffects.ts — a completed GM/world clock's
   * AI-decided mechanical follow-through (spawned clock, location
   * condition hit, faction stat nudge), distinguishing it from an
   * ordinary tick or ambition-resolution write to the same field.
   * 'sceneResolution' changes (#175) come from the main per-exchange AI GM
   * response path (stateUpdater.ts's domain appliers applying
   * pc_changes/npc_changes/faction_changes/etc. directly) — the highest-
   * frequency source of state change in the engine, and until now the only
   * one with no WorldEvent record at all. Distinct from 'consequence',
   * which is a separate, dedicated consequence-extraction AI pass over
   * scene text (see consequences.ts) — both are player-caused, but from
   * genuinely different pipelines.
   */
  origin?: 'tick' | 'consequence' | 'integrity' | 'wake' | 'clockResolution' | 'sceneResolution'
  /** Set only when origin is 'integrity' — the IntegrityCheck.key that
   * produced this repair, so escalation (integrity/escalation.ts) can tell
   * "this got repaired again" apart from "this field just changed again in
   * ordinary play". */
  checkKey?: string
}

export interface TickContext {
  campaignId: string
  turnNumber: number
  /** World Sim Phase 8: resolved once per tick in worldTick.ts — see caps.ts. */
  factionCap: number
  npcCap: number
  /**
   * World Sim Phase 8: preview mode — handlers still read live DB state and
   * compute the same WorldChange list they normally would, but every write
   * call is skipped. Defaults to false (the normal, persisting tick).
   */
  dryRun: boolean
  /**
   * World Sim Phase 3 (Integrity Engine plan) — every handler writes through
   * this instead of importing the `prisma` singleton directly, so
   * runWorldTick can wrap the whole deterministic tick in one
   * `prisma.$transaction`: a real `Prisma.TransactionClient` on a normal
   * tick (a failed turn now rolls back cleanly instead of leaving partial
   * state), or the plain `PrismaClient` singleton on a dry run (a preview
   * has nothing to roll back, and holding a transaction open for a
   * read-only pass would just be overhead).
   */
  db: Prisma.TransactionClient | PrismaClient
  /**
   * #103 (Wake): same-turn handler-to-handler scratch space. tickFactions
   * and tickFactionLeadership already compute "how rough was this
   * transition" (collapse/successionRoughness) for their own purposes and
   * then discard it — this lets tickWake, which runs later in the same
   * pass over the same `ctx` reference, read those values back out instead
   * of recomputing "how bad was this" a second, independent way. Optional
   * so every existing test's literal TickContext fixture keeps compiling
   * unchanged; only worldTick.ts's real ctx and the three handlers that
   * touch this need to know it exists. Faction id -> roughness (0-1).
   */
  collapseRoughnessByFactionId?: Map<string, number>
  successionRoughnessByFactionId?: Map<string, number>
  /**
   * #263: resolved once in worldTick.ts via the same `deriveSeason`
   * function tickSeasonalPressure calls independently for its own two
   * knobs (resourceRegenDelta/clockSpeedMultiplier — that handler's own
   * calendarConfig read is left as-is, not refactored onto this field, to
   * avoid touching its already-tested query shape for this change).
   * tickWeather reads this to bias its transition pick toward the season.
   * Optional so every existing test's literal TickContext fixture keeps
   * compiling unchanged; undefined behaves exactly like the pre-#263
   * season-blind pick.
   */
  season?: Season
}

/**
 * A faction has deterministically earned a major ambition this tick (see
 * ambitionTick.ts) but the specific flavor of it is left to the offscreen
 * AI narration path — the tick decides WHETHER, not WHAT. fallbackName/
 * fallbackConsequence/maxTicks/category are used verbatim if the AI call
 * fails or doesn't address this faction, so an ambition never silently
 * goes nowhere.
 *
 * `category` is the MECHANICAL pacing category ('social' | 'urgent', from
 * the goal) that gets persisted to Clock.category and drives tick speed —
 * never the narrative flavor. `archetype` + `fallbackFlavor` are the
 * narrative side: archetype picks which bounded flavor list a faction draws
 * from (see AMBITION_CATEGORY_OPTIONS in ambitionTick.ts), and
 * fallbackFlavor is that list's first entry, used if the AI doesn't pick one.
 */
export interface PendingAmbition {
  factionId: string
  factionName: string
  goal: string
  archetype: string
  maxTicks: number
  category: string
  fallbackFlavor: string
  fallbackName: string
  fallbackConsequence: string
  /** Set only for DESTABILIZE_RIVAL ambitions — the rival being undermined, so its resolution can apply real damage to a specific faction instead of just the one that committed to it. */
  targetFactionId?: string
  targetFactionName?: string
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
 * Shape of one entry in the Faction.relationships JSON column, keyed by the
 * other faction's id. Written by relationshipTick.ts; read by nearly every
 * other tick handler. Lives here (not in relationshipTick.ts) so
 * factionTick.ts can use the helpers below without an import cycle —
 * relationshipTick already imports band() from factionTick.
 */
export interface FactionRelationshipEntry {
  type: 'RIVAL' | 'ALLY'
  since: number
}

/**
 * Parse the Faction.relationships JSON column into its real shape. The one
 * blessed replacement for the `(x as any as Record<...>) || {}` cast that
 * used to be copy-pasted across every consumer.
 */
export function parseFactionRelationships(value: unknown): Record<string, FactionRelationshipEntry> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, FactionRelationshipEntry>
}

/** First faction id on record as a RIVAL, if any. */
export function findRivalId(relationships: unknown): string | undefined {
  return Object.entries(parseFactionRelationships(relationships)).find(([, r]) => r.type === 'RIVAL')?.[0]
}

/** Every faction id on record as a RIVAL. */
export function findRivalIds(relationships: unknown): string[] {
  return Object.entries(parseFactionRelationships(relationships))
    .filter(([, r]) => r.type === 'RIVAL')
    .map(([id]) => id)
}

/**
 * Whether any on-record rival still exists as an active faction. The
 * active-set parameter is required on purpose: the stale-rival bug this
 * helper exists to prevent came from one call site checking `type ===
 * 'RIVAL'` without asking whether the rival had since collapsed.
 */
export function hasActiveRival(relationships: unknown, activeFactionIds: Set<string>): boolean {
  return Object.entries(parseFactionRelationships(relationships)).some(
    ([otherId, r]) => r.type === 'RIVAL' && activeFactionIds.has(otherId)
  )
}

/** #111: every faction id on record as an ALLY — mirrors findRivalIds.
 * Nothing acted on an ALLY tag mechanically before this except
 * warTick.ts's coalition-building; economyTick.ts's loan-extension is the
 * second. */
export function findAllyIds(relationships: unknown): string[] {
  return Object.entries(parseFactionRelationships(relationships))
    .filter(([, r]) => r.type === 'ALLY')
    .map(([id]) => id)
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
