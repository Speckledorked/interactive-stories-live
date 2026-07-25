// src/lib/game/corruptionGates.ts
//
// Corruption as a real content gate (README #83).
//
// Before this, corruption gated exactly one thing — unlocking a shadow
// capability — plus a +2 surge and prompt flavor. That's a complete
// cost/benefit loop but a private one: a five-mark character could walk
// into any temple, take any job, and lean on any ally's goodwill, and
// nothing in the world reacted. "Power at a cost" was true of the
// character sheet and false of everything outside it.
//
// THE SAFETY RULE, and why it exists: marks are irreversible and capped at
// one per scene. A gate evaluated against state a character already holds
// would therefore be a one-way trap — gain a mark mid-campaign and get
// permanently locked inside a room, or hold an active quest you can never
// again progress. So every gate here applies at a BOUNDARY and never
// retroactively:
//
//   locations — checked on ENTRY. Your current location is never
//               re-evaluated; you can be refused a door, never ejected
//               through one you already walked through.
//   quests    — checked on ACQUISITION. An already-active quest is never
//               revoked, and completion is never blocked. Corruption can
//               stop you taking a job; it cannot strand you mid-job.
//   NPCs      — checked on LEVERAGE, which has no lasting state to trap:
//               a repulsed NPC's rapport simply doesn't help your roll
//               this time, and helps again if the gate stops applying.
//
// That rule is what makes full content gating safe to ship against an
// irreversible track. It costs nothing in expressiveness: everything a
// gate is *for* — the shrine that only opens to the marked, the order that
// turns away the tainted — happens at a boundary anyway.

import { MAX_CORRUPTION } from './corruption'

/** Anything that can carry a corruption requirement. */
export interface CorruptionGated {
  minCorruption?: number | null
  maxCorruption?: number | null
}

export type GateRefusal = 'too_clean' | 'too_corrupt'

export interface GateResult {
  allowed: boolean
  /** Why it was refused, or null when allowed. */
  refusal: GateRefusal | null
}

const ALLOWED: GateResult = { allowed: true, refusal: null }

function bounded(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Math.max(0, Math.min(MAX_CORRUPTION, Math.trunc(n)))
}

/**
 * Can a character at this corruption level pass this gate? Pure.
 *
 * `hasTheme` is the campaign-level switch: a universe with no corruption
 * theme has no corruption, so a gate left on a row from an imported or
 * re-themed campaign must not silently lock content. Gating is off
 * entirely there, matching how the rest of the track disables itself.
 *
 * An ungated entity always passes, which is every entity by default —
 * gates are opt-in per row, so nothing that exists today changes behavior.
 */
export function checkCorruptionGate(
  entity: CorruptionGated | null | undefined,
  corruption: number,
  hasTheme: boolean
): GateResult {
  if (!hasTheme || !entity) return ALLOWED

  const min = bounded(entity.minCorruption)
  const max = bounded(entity.maxCorruption)
  if (min === null && max === null) return ALLOWED

  const marks = bounded(corruption) ?? 0

  if (min !== null && marks < min) return { allowed: false, refusal: 'too_clean' }
  if (max !== null && marks > max) return { allowed: false, refusal: 'too_corrupt' }
  return ALLOWED
}

/**
 * A gate whose bounds cross (min above max) can never be passed by anyone.
 * That's almost certainly an authoring mistake rather than an intentional
 * dead end, and it's worth surfacing rather than silently hiding content
 * from every character forever.
 */
export function isImpossibleGate(entity: CorruptionGated | null | undefined): boolean {
  if (!entity) return false
  const min = bounded(entity.minCorruption)
  const max = bounded(entity.maxCorruption)
  return min !== null && max !== null && min > max
}

/**
 * In-fiction phrasing for a refusal, for the narrator and the player-facing
 * message. Deliberately never mentions numbers or the word "corruption" —
 * the theme supplies its own vocabulary, the same discipline
 * describeCorruptionForPrompt follows.
 */
export function describeRefusal(refusal: GateRefusal, themeName: string): string {
  return refusal === 'too_clean'
    ? `it does not open to anyone untouched by ${themeName}`
    : `what ${themeName} has made of you is not welcome here`
}

/**
 * Whether a gate exists at all — used to decide if an entity is worth
 * mentioning to the narrator as gated.
 */
export function hasCorruptionGate(entity: CorruptionGated | null | undefined): boolean {
  if (!entity) return false
  return bounded(entity.minCorruption) !== null || bounded(entity.maxCorruption) !== null
}
