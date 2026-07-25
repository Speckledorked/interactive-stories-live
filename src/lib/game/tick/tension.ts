// src/lib/game/tick/tension.ts
//
// Dramatic tension as a real, derived quantity (README #90).
//
// WorldMeta.tension and WorldMeta.phase existed as columns for a long time
// with nothing writing them, so every campaign sat at the default forever
// and the export dump was their only reader. The names promised a pacing
// model; there wasn't one. This is that model.
//
// Two rules it follows, both matching how the rest of this engine works:
//
//  1. It is DERIVED, never reported. The AI does not get to say how tense
//     the story is — tension is computed from state the simulation already
//     owns (clocks near firing, live wars, party harm, standing threats),
//     the same way faction stat drift and weather are. A gauge the
//     narrator could set would just be the narrator's opinion of itself.
//
//  2. It has a mechanical consumer, not just a prompt line. See
//     tensionClockBonus below: in a tense campaign, GM-authored threats
//     with no faction driving them close faster. Without that, this would
//     be another well-named number nothing reads.

/** Everything tension is computed from. Snapshot, not live objects. */
export interface TensionInputs {
  /** Active clocks, as fill ratios 0..1 (currentTicks / maxTicks). */
  clockFillRatios: number[]
  /** How many wars are currently ESCALATING. */
  activeWarCount: number
  /** Living player characters' harm values (0-6 each). */
  partyHarm: number[]
  /** threatLevel (1-5) of each active, discovered faction. */
  factionThreatLevels: number[]
}

export const TENSION_MIN = 0
export const TENSION_MAX = 100
/** Where a campaign with nothing going on sits. */
export const TENSION_BASELINE = 25

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/**
 * Compute tension from current world state. Pure and deterministic — the
 * same world always produces the same number, so this can be recomputed
 * from scratch every turn rather than drifting as an accumulator.
 *
 * Weighting rationale: an almost-full clock is the single most tense thing
 * in a PbtA-style game (a countdown about to fire), so clocks dominate.
 * War and injured characters raise the floor. Standing threat level
 * contributes least — a dangerous faction that isn't *doing* anything is
 * background dread, not tension.
 */
export function computeTension(inputs: TensionInputs): number {
  // Clocks: the nearest-to-firing clock matters far more than the count of
  // idle ones, so this is weighted toward the maximum rather than a mean.
  const maxFill = inputs.clockFillRatios.length > 0 ? Math.max(...inputs.clockFillRatios) : 0
  const avgFill =
    inputs.clockFillRatios.length > 0
      ? inputs.clockFillRatios.reduce((a, b) => a + b, 0) / inputs.clockFillRatios.length
      : 0
  const clockPressure = (maxFill * 0.7 + avgFill * 0.3) * 40

  // Wars: real, ongoing, and visible. Saturates — a fourth simultaneous
  // war doesn't make a campaign meaningfully tenser than three.
  const warPressure = Math.min(inputs.activeWarCount, 3) * 8

  // Party harm: an injured party raises stakes regardless of plot.
  const avgHarm =
    inputs.partyHarm.length > 0
      ? inputs.partyHarm.reduce((a, b) => a + b, 0) / inputs.partyHarm.length
      : 0
  const harmPressure = (avgHarm / 6) * 20

  // Standing threats: weakest signal, deliberately. Contributes only via
  // the most dangerous faction on the board.
  const maxThreat = inputs.factionThreatLevels.length > 0 ? Math.max(...inputs.factionThreatLevels) : 0
  const threatPressure = (clamp(maxThreat, 0, 5) / 5) * 12

  return Math.round(
    clamp(TENSION_BASELINE + clockPressure + warPressure + harmPressure + threatPressure, TENSION_MIN, TENSION_MAX)
  )
}

export type CampaignPhase = 'setup' | 'rising' | 'climax' | 'aftermath'

/**
 * Derive the story-arc phase from tension and how far along the campaign
 * is. Pure.
 *
 * `aftermath` is deliberately distinct from `setup` even though both are
 * low-tension: a quiet stretch twenty scenes in reads differently from the
 * opening of a campaign, and the narrator should treat them differently.
 */
export function derivePhase(tension: number, turnNumber: number): CampaignPhase {
  if (tension >= 75) return 'climax'
  if (tension >= 45) return 'rising'
  // Below the rising threshold, position in the campaign decides which
  // kind of quiet this is.
  return turnNumber <= 10 ? 'setup' : 'aftermath'
}

/**
 * The mechanical consumer: how much tension accelerates a clock that has
 * no faction or NPC driving it.
 *
 * Only GM-authored/unattached clocks consult this. Clocks driven by a real
 * faction ambition or NPC scheme are already paced by that actor's own
 * strength and must not be double-counted — their pacing is a statement
 * about the faction, not about the mood.
 *
 * Deliberately small (0 or 1). Tension nudges pacing; it never overrides
 * the deterministic drivers, and a runaway feedback loop (tense campaign →
 * faster clocks → more tension) is exactly what a bigger number would
 * cause.
 */
export function tensionClockBonus(tension: number): number {
  return tension >= 75 ? 1 : 0
}

/** Short human-readable band, for the prompt and admin display. */
export function describeTension(tension: number): string {
  if (tension >= 75) return 'breaking point'
  if (tension >= 60) return 'high'
  if (tension >= 40) return 'building'
  if (tension >= 25) return 'simmering'
  return 'calm'
}
