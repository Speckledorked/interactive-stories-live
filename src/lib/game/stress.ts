// src/lib/game/stress.ts
// Accumulated psychological pressure on a player character (0-10). The
// individual-PC counterpart to the tick engine's NPC/Faction disposition
// vectors (tick/npcDispositionTick.ts, tick/beliefTick.ts) — same closed-
// axis, drift-from-classified-events shape — but PCs aren't touched by the
// deterministic world tick at all, so this drifts at SCENE RESOLUTION time
// instead of a turn later, classified from signals already present in the
// same pc_changes apply pass (worldUpdaters/characters.ts): this exchange's
// outcome band, harm taken, a costly consequence, a corruption mark.
// Never a field the AI reports directly — same "engine decides" boundary
// dice rolls and corruption already keep.
//
// Unlike corruption (irreversible by design), stress RECOVERS: a scene with
// none of the raise triggers below decays it by DRIFT_AMOUNT rather than
// leaving it to only ever climb — the whole point is it tracks the
// character's CURRENT load, not a permanent scar.
//
// Fully hidden — not even a qualitative band the way capability proficiency
// gets one (proficiencyBand in capabilities.ts). A visible number here would
// turn "did I fail?" into "am I about to trigger my evolution," the exact
// gaming-the-meter problem Character.relationships is already kept hidden
// to avoid. The only player-facing surface is the eventual evolution offer
// itself (advancement.ts), framed diegetically, never as a stat.

import { clamp } from './tick/types'

export const MAX_STRESS = 10
// Above this, an evolution offer becomes eligible (see advancement.ts) —
// comfortably above the midpoint so an ordinary rough patch doesn't trigger
// one; requires real, repeated pressure.
export const STRESS_EVOLUTION_THRESHOLD = 7

const DRIFT_AMOUNT = 1

export type StressDriftEventKind = 'MISS_TAKEN' | 'HARM_TAKEN' | 'CONSEQUENCE_COST' | 'CORRUPTION_MARK'

export interface StressDriftEvent {
  kind: StressDriftEventKind
}

/**
 * Pure — no DB access. Folds this exchange's classified events into the
 * character's current stress. Each event kind nudges by DRIFT_AMOUNT
 * (HARM_TAKEN counts double — it's the one raise signal with an intensity
 * dimension already available, via harm_damage). No events at all this
 * exchange means recovery: decay by DRIFT_AMOUNT instead of holding steady,
 * since the whole point of the track is CURRENT load, not a ratchet.
 */
export function decideStressDrift(current: number, events: StressDriftEvent[]): number {
  if (events.length === 0) {
    return clamp(current - DRIFT_AMOUNT, 0, MAX_STRESS)
  }
  let next = current
  for (const event of events) {
    const amount = event.kind === 'HARM_TAKEN' ? DRIFT_AMOUNT * 2 : DRIFT_AMOUNT
    next = clamp(next + amount, 0, MAX_STRESS)
  }
  return next
}

// A graze doesn't count — only real, meaningful harm registers as
// pressure. Matches this codebase's own "a solid hit is 2-3" framing
// (scenePrompt.ts's harm_damage guidance).
const SERIOUS_HARM_THRESHOLD = 2

/** Consequence types that read as a genuine cost, not routine bookkeeping — a promise made isn't pressure, but something hunting you or hanging over you is. */
const COSTLY_CONSEQUENCE_TYPES: ReadonlySet<string> = new Set(['enemy', 'longTermThreat'])

export interface StressSignal {
  /** This character's outcome band for the exchange, from the engine's own pre-rolled action_mechanics — never the AI's outcome_echo self-report. Undefined when nothing was rolled for them this exchange. */
  outcome?: 'strongHit' | 'weakHit' | 'miss'
  /** pc_changes.changes.harm_damage for this character this exchange, before armor mitigation is irrelevant here — the AI's reported severity is what "registers" narratively. */
  harmDamage?: number
  /** The types reported in this character's consequences_add this exchange. */
  consequenceTypesAdded?: string[]
  /** True when a real corruption mark was applied this exchange (result.applied > 0 in corruption.ts's applyCorruptionMarks) — not merely requested. */
  gainedCorruptionMark?: boolean
}

/**
 * Pure — classifies one character's already-computed exchange signals into
 * StressDriftEvents. Deliberately reads data the engine already computed
 * for OTHER purposes this same pass (the binding outcome band, applied
 * harm, applied consequences, an applied corruption mark) rather than a
 * new AI-reported field, so there's nothing new for the model to omit or
 * hallucinate.
 */
export function classifyStressEvents(signal: StressSignal): StressDriftEvent[] {
  const events: StressDriftEvent[] = []
  if (signal.outcome === 'miss') events.push({ kind: 'MISS_TAKEN' })
  if ((signal.harmDamage ?? 0) >= SERIOUS_HARM_THRESHOLD) events.push({ kind: 'HARM_TAKEN' })
  if ((signal.consequenceTypesAdded ?? []).some((t) => COSTLY_CONSEQUENCE_TYPES.has(t))) events.push({ kind: 'CONSEQUENCE_COST' })
  if (signal.gainedCorruptionMark) events.push({ kind: 'CORRUPTION_MARK' })
  return events
}
