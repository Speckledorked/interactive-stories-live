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
import type { TickRoster } from './capOrdering'
import type { TieEntry } from '../tieGraph'
import type { SimTurn } from '../turnClock'

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
  /**
   * #310: set only when origin is 'wake' — ActiveWake.sourceType ('NPC' |
   * 'FACTION' | 'FACTION_DEFAULT'). Three independent handlers all write
   * the identical (FACTION, field: 'stability', origin: 'wake') shape:
   * wakeTick.ts's NPC-death ripple, its faction-collapse ripple, and
   * economyTick.ts's loan-default cascade. Without this, a faction merely
   * absorbing a shockwave from an ally's defaulted loan was
   * indistinguishable from genuine institutional-memory loss (a member's
   * death or a faction's own collapse) to npcDispositionTick.ts's
   * FACTION_ABANDONED_THEM classification and beliefTick.ts's
   * COLLAPSE_RIPPLE_SURVIVED classification, both of which now branch on
   * this field instead of inferring cause purely from origin: 'wake'.
   */
  wakeSourceType?: 'NPC' | 'FACTION' | 'FACTION_DEFAULT'
  /**
   * #101 v1.1: where this change actually happened, captured at write time
   * (e.g. an NPC's or a war's contested location) — used by
   * tick/informationTick.ts to compute an accurate TOLD-propagation delay
   * instead of approximating from the target entity's CURRENT location,
   * which drifts once the entity moves. Omitted for change types with no
   * single natural location (FACTION-non-war, QUEST, CHARACTER, DEBT).
   */
  originLocationId?: string | null
}

export interface TickContext {
  campaignId: string
  /**
   * #437: the SIMULATION turn (WorldMeta.simulationTurn), never the scene
   * counter. Every handler's elapsed-time arithmetic — information latency,
   * loan maturity, war duration, goal commitment windows, drift watermarks —
   * is measured in world turns, and every turn column a handler writes is a
   * sim-clock column. Branded so a scene counter cannot be substituted, in
   * production or in a test fixture. See turnClock.ts.
   */
  turnNumber: SimTurn
  /** World Sim Phase 8: resolved once per tick in worldTick.ts — see caps.ts. */
  factionCap: number
  npcCap: number
  /**
   * #375: WHICH factions and NPCs this tick simulates, resolved once in
   * worldTick.ts before the handler pass (see tick/capOrdering.ts).
   *
   * Handlers filter with `id: { in: ctx.roster.factionIds }` and must NOT
   * run their own capped/rotated query. They used to, and because each one
   * bumped lastTickedAt with the TRANSACTION client immediately after its
   * own query, every handler in a single transaction selected a different
   * slice of the roster — dissolving the same-tick ordering chain, breaking
   * determinism, and making dry-run preview a different simulation than the
   * real tick.
   *
   * Optional so every existing single-handler test's literal TickContext
   * fixture keeps compiling. When absent (unit tests only — runWorldTick
   * always supplies it) rosterFactionFilter/rosterNpcFilter produce an
   * empty predicate, so the handler simulates exactly what its mocked
   * query returns. That is what a unit test wants and, crucially, is NOT
   * a fallback to the old per-handler rotation: no handler may re-derive
   * its own capped slice. capOrdering.convention.test.ts enforces that.
   */
  roster?: TickRoster
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
  /**
   * #402: the in-fiction clock, resolved once per tick in worldTick.ts.
   *
   * npcTick derives time of day from this rather than from turnNumber % 4
   * — those were two unreconciled notions of "what time is it", so an
   * NPC's working day ran on a clock unrelated to the date the player is
   * shown. Optional so existing single-handler test fixtures keep
   * compiling; absent falls back to the old turn-derived value.
   */
  totalElapsedGameHours?: number
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
  turnNumber: SimTurn
  timestamp: Date
  changes: WorldChange[]
  historyEntriesCreated: number
  pendingAmbitions: PendingAmbition[]
}

/**
 * One faction's stance toward another. Written by relationshipTick.ts; read
 * by nearly every other tick handler. Re-exported here (not defined here) so
 * factionTick.ts can use the helpers below without an import cycle —
 * relationshipTick already imports band() from factionTick.
 *
 * #373: this used to be "the shape of one entry in the Faction.relationships
 * JSON column". It is now the projection of a FactionTie row, which is the
 * same shape read from a real edge instead of a blob.
 */
export type FactionRelationshipEntry = TieEntry

/**
 * A faction's neighbours, keyed by the other faction's id.
 *
 * The helpers below take this projected record rather than a raw column,
 * because there is no longer a raw column: `parseFactionRelationships` was
 * the blessed way to cast a JSON blob, and #373 removed the blob. Call
 * `factionTies(faction)` (tieGraph.ts) on a row selected with TIE_INCLUDE.
 */
export type FactionRelationshipMap = Record<string, FactionRelationshipEntry>

/**
 * The faction most plausibly meant by "their rival", if any.
 *
 * #403: this used to be `Object.entries(...).find(...)` — whichever RIVAL
 * key JavaScript happened to yield first, i.e. insertion order in a JSON
 * column. warTick.ts:630 uses the result to decide WHO a war ignites
 * against, so a load-bearing decision was being made by object key order.
 *
 * Now deterministic: the longest-standing rivalry wins (the grudge with
 * the most history behind it is the one a war is about), ties broken by
 * id so the result is stable across runs and across two factions whose
 * rivalries began on the same turn.
 */
export function findRivalId(relationships: FactionRelationshipMap): string | undefined {
  return findRivalIds(relationships)[0]
}

/**
 * Every faction id on record as a RIVAL, oldest rivalry first.
 *
 * Ordering is part of the contract — see findRivalId.
 */
export function findRivalIds(relationships: FactionRelationshipMap): string[] {
  return Object.entries(relationships)
    .filter(([, r]) => r.type === 'RIVAL')
    .sort(([idA, a], [idB, b]) => {
      // `since` may be absent on rows written before it existed; treat
      // those as the oldest, which is what an unknown start date implies.
      const sinceA = typeof a.since === 'number' ? a.since : -1
      const sinceB = typeof b.since === 'number' ? b.since : -1
      if (sinceA !== sinceB) return sinceA - sinceB
      return idA.localeCompare(idB)
    })
    .map(([id]) => id)
}

/**
 * #403/#373: the canonical-ordering violations in a set of faction tie rows.
 *
 * This used to be `relationshipAsymmetries` — Faction.relationships was
 * written symmetrically by relationshipEngine.ts (it set both `aTies[b.id]`
 * and `bTies[a.id]`) and read one-sidedly everywhere else, so symmetry was
 * a property of the DATA enforced only by the one writer that happened to
 * do it. Any other path (an admin route, an integrity repair, an
 * AI-driven change, an import) could produce a legal-looking asymmetric
 * map that no reader detected.
 *
 * #373 made asymmetry unrepresentable: one canonical row per pair, with a
 * DB CHECK requiring aId < bId. So the question changed rather than
 * disappearing — the property that now carries symmetry is the canonical
 * ordering, and this is what checks it. Two rows for one pair, or a row
 * whose endpoints are in the wrong order, is what asymmetry looks like now.
 */
export function tieOrderingViolations(
  ties: Array<{ aId: string; bId: string }>
): Array<{ aId: string; bId: string; problem: 'reversed' | 'self' | 'duplicate' }> {
  const problems: Array<{ aId: string; bId: string; problem: 'reversed' | 'self' | 'duplicate' }> = []
  const seen = new Set<string>()

  for (const tie of ties) {
    if (tie.aId === tie.bId) {
      problems.push({ aId: tie.aId, bId: tie.bId, problem: 'self' })
      continue
    }
    if (tie.aId > tie.bId) {
      problems.push({ aId: tie.aId, bId: tie.bId, problem: 'reversed' })
      continue
    }
    const key = `${tie.aId} ${tie.bId}`
    if (seen.has(key)) {
      problems.push({ aId: tie.aId, bId: tie.bId, problem: 'duplicate' })
      continue
    }
    seen.add(key)
  }
  return problems
}

/**
 * Whether any on-record rival still exists as an active faction. The
 * active-set parameter is required on purpose: the stale-rival bug this
 * helper exists to prevent came from one call site checking `type ===
 * 'RIVAL'` without asking whether the rival had since collapsed.
 */
export function hasActiveRival(relationships: FactionRelationshipMap, activeFactionIds: Set<string>): boolean {
  return Object.entries(relationships).some(
    ([otherId, r]) => r.type === 'RIVAL' && activeFactionIds.has(otherId)
  )
}

/** #111: every faction id on record as an ALLY — mirrors findRivalIds.
 * Nothing acted on an ALLY tag mechanically before this except
 * warTick.ts's coalition-building; economyTick.ts's loan-extension is the
 * second. */
export function findAllyIds(relationships: FactionRelationshipMap): string[] {
  return Object.entries(relationships)
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
