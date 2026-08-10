// src/lib/game/worldUpdaters/sceneProgress.ts
// Domain applier for scene_progress — the scene progress ledger (see
// prisma/schema.prisma's Scene.progressState comment). Pure and exported
// for direct testing, same convention as sceneResolutionRequest.ts's
// deriveEffectiveSceneEnding: no DB access in here, the caller
// (sceneResolver.ts) does the actual prisma.scene.update and any
// TimelineEvent creation for significant beats.
//
// The whole point: "what's already been established/resolved in this
// scene" used to be re-derived by the model re-reading raw prose each
// exchange (see sceneResolutionRequest.ts's history). This applier
// maintains a real, bounded, explicit ledger instead — appended to for
// events (facts/beats), overwritten for state (activeConflict/
// npcIntentions) — see the schema comment for why those two shapes are
// deliberately not conflated.

import type { SceneProgress } from '@/lib/ai/schema'

export interface SceneProgressState {
  establishedFacts: string[]
  resolvedBeats: Array<{ exchange: number; text: string; significant: boolean }>
  activeConflict: string | null
  npcIntentions: Record<string, string>
  lastProgressExchange: number
}

// Bounded the same way gm_notes_history already is (worldMetaNotes.ts's
// MAX_GM_NOTES_HISTORY = 20) — oldest trimmed first once a scene runs long
// enough to need it, which most scenes never will (SCENE_RUNAWAY_EXCHANGE_
// CEILING already forces an ending well before either cap could bind hard).
export const MAX_ESTABLISHED_FACTS = 15
export const MAX_RESOLVED_BEATS = 10

export function createDefaultSceneProgressState(): SceneProgressState {
  return {
    establishedFacts: [],
    resolvedBeats: [],
    activeConflict: null,
    npcIntentions: {},
    lastProgressExchange: 0,
  }
}

/**
 * Lenient parse of Scene.progressState's raw JSON — same defensive
 * convention as harm.ts's parseHarmState: never throws on missing/
 * malformed/legacy (pre-this-feature, i.e. null) data, just falls back to
 * an empty ledger field by field.
 */
export function parseSceneProgressState(value: unknown): SceneProgressState {
  const state = createDefaultSceneProgressState()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return state

  const raw = value as Record<string, unknown>
  if (Array.isArray(raw.establishedFacts)) {
    state.establishedFacts = raw.establishedFacts.filter((f): f is string => typeof f === 'string')
  }
  if (Array.isArray(raw.resolvedBeats)) {
    state.resolvedBeats = raw.resolvedBeats
      .filter((b): b is Record<string, unknown> => !!b && typeof b === 'object')
      .map((b) => ({
        exchange: Number.isFinite(Number(b.exchange)) ? Number(b.exchange) : 0,
        text: typeof b.text === 'string' ? b.text : '',
        significant: b.significant === true,
      }))
      .filter((b) => b.text.length > 0)
  }
  if (typeof raw.activeConflict === 'string' || raw.activeConflict === null) {
    state.activeConflict = raw.activeConflict as string | null
  }
  if (raw.npcIntentions && typeof raw.npcIntentions === 'object' && !Array.isArray(raw.npcIntentions)) {
    const entries = Object.entries(raw.npcIntentions as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    state.npcIntentions = Object.fromEntries(entries)
  }
  const lastProgressExchange = Number(raw.lastProgressExchange)
  if (Number.isFinite(lastProgressExchange) && lastProgressExchange >= 0) {
    state.lastProgressExchange = lastProgressExchange
  }
  return state
}

export interface ApplySceneProgressResult {
  progressState: SceneProgressState
  // Newly-resolved beats flagged significant this exchange — the caller
  // turns each into a real TimelineEvent (story log/wiki), same bar as any
  // other notable moment. Only the NEW ones, not the whole history, so a
  // beat never gets a duplicate TimelineEvent on a later exchange.
  newSignificantBeats: string[]
  // Whether this exchange counted as real progress (a new beat, or
  // activeConflict genuinely changing) — what buildPacingSection reads
  // instead of raw exchange count to detect an actual stall.
  madeProgress: boolean
}

function normalizeFact(fact: string): string {
  return fact.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.!?]+$/, '')
}

/**
 * Apply one exchange's scene_progress report onto the scene's existing
 * ledger. Dedup is exact-normalized-string only (case/whitespace/trailing-
 * punctuation insensitive) — deliberately not fuzzy the way entity name
 * resolution is: two facts that merely resemble each other are more likely
 * two genuinely different facts than an entity-name typo is, so a false
 * dedup here would silently drop something real. A little redundancy in
 * the ledger costs far less than losing a fact.
 */
export function applySceneProgress(
  rawCurrentState: unknown,
  report: SceneProgress | undefined,
  currentExchange: number
): ApplySceneProgressResult {
  const state = parseSceneProgressState(rawCurrentState)
  const newSignificantBeats: string[] = []
  let madeProgress = false

  if (report?.new_established_facts?.length) {
    const existingNormalized = new Set(state.establishedFacts.map(normalizeFact))
    for (const fact of report.new_established_facts) {
      const trimmed = fact.trim()
      if (!trimmed) continue
      const normalized = normalizeFact(trimmed)
      if (existingNormalized.has(normalized)) continue
      existingNormalized.add(normalized)
      state.establishedFacts.push(trimmed)
    }
    if (state.establishedFacts.length > MAX_ESTABLISHED_FACTS) {
      state.establishedFacts = state.establishedFacts.slice(-MAX_ESTABLISHED_FACTS)
    }
  }

  if (report?.new_resolved_beats?.length) {
    const existingNormalized = new Set(state.resolvedBeats.map((b) => normalizeFact(b.text)))
    for (const beat of report.new_resolved_beats) {
      const trimmed = beat.text.trim()
      if (!trimmed) continue
      const normalized = normalizeFact(trimmed)
      if (existingNormalized.has(normalized)) continue
      existingNormalized.add(normalized)
      state.resolvedBeats.push({ exchange: currentExchange, text: trimmed, significant: beat.significant === true })
      madeProgress = true
      if (beat.significant) newSignificantBeats.push(trimmed)
    }
    if (state.resolvedBeats.length > MAX_RESOLVED_BEATS) {
      state.resolvedBeats = state.resolvedBeats.slice(-MAX_RESOLVED_BEATS)
    }
  }

  if (report?.active_conflict !== undefined) {
    const trimmed = report.active_conflict.trim()
    if (trimmed && trimmed !== state.activeConflict) {
      state.activeConflict = trimmed
      madeProgress = true
    }
  }

  if (report?.npc_intentions?.length) {
    for (const { npc_name_or_id, intention } of report.npc_intentions) {
      if (npc_name_or_id && intention) state.npcIntentions[npc_name_or_id] = intention.trim()
    }
  }

  if (madeProgress) {
    state.lastProgressExchange = currentExchange
  }

  return { progressState: state, newSignificantBeats, madeProgress }
}
