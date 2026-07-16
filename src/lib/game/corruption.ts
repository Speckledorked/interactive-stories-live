// src/lib/game/corruption.ts
// Corruption track — per-universe "power at a cost". The THEME (what
// corruption even is in this world) is generated at campaign creation
// (lib/ai/worldExtras.ts) and lives on Campaign.corruptionTheme; a null
// theme means this universe has no such concept and the track is disabled
// everywhere. Crucially, corruption is defined by the fiction's own
// devil's bargain — never by aesthetics. A dark-affinity power set (a
// dark/blood/shadow essence kit) is NOT corruption unless the universe's
// fiction says wielding it costs the self.
//
// Marks are irreversible by design (they never decrease) and capped at
// one per scene so a single dramatic exchange can't consume a character.

export const MAX_CORRUPTION = 5
// The final stage: the character is slipping beyond the player's control.
export const CONSUMED_CONDITION_NAME = 'Consumed'

export interface CorruptionTheme {
  name: string // "Essence Saturation", "The Whispering Debt", ...
  description: string // what this force is and why power drawn from it costs
  // Exactly MAX_CORRUPTION in-fiction stage descriptions, stages[0] = first mark.
  stages: string[]
  // Guidance for the AI on when a bargain is appropriate (used in prompts).
  bargainGuidance?: string
}

/** Parse the Json column into a usable theme, or null if absent/malformed. */
export function parseCorruptionTheme(raw: unknown): CorruptionTheme | null {
  if (!raw || typeof raw !== 'object') return null
  const t = raw as any
  if (!t.name || !t.description || !Array.isArray(t.stages) || t.stages.length === 0) return null
  return {
    name: String(t.name),
    description: String(t.description),
    stages: t.stages.map((s: unknown) => String(s)),
    bargainGuidance: t.bargainGuidance ? String(t.bargainGuidance) : undefined,
  }
}

export interface CorruptionMarkResult {
  newValue: number
  applied: number // 0 or 1 — clamped to one mark per scene
  reachedMax: boolean
}

/**
 * Apply requested corruption marks. Never decreases (negative/zero requests
 * are no-ops), at most one mark per scene regardless of what the AI asked
 * for, hard-capped at MAX_CORRUPTION.
 */
export function applyCorruptionMarks(current: number, requestedMarks: number): CorruptionMarkResult {
  const safeCurrent = Math.max(0, Math.min(MAX_CORRUPTION, Math.floor(current) || 0))
  if (!Number.isFinite(requestedMarks) || requestedMarks < 1 || safeCurrent >= MAX_CORRUPTION) {
    return { newValue: safeCurrent, applied: 0, reachedMax: safeCurrent >= MAX_CORRUPTION }
  }
  const newValue = safeCurrent + 1
  return { newValue, applied: 1, reachedMax: newValue >= MAX_CORRUPTION }
}

/** The in-fiction stage description for a corruption value; null at 0. */
export function corruptionStage(theme: CorruptionTheme, value: number): string | null {
  if (value <= 0) return null
  const idx = Math.min(value, theme.stages.length) - 1
  return theme.stages[idx] ?? null
}

/**
 * One line for the AI prompt describing where a character stands on the
 * track — qualitative, no bare numbers, consistent with fog-of-war style.
 */
export function describeCorruptionForPrompt(theme: CorruptionTheme, value: number): string {
  if (value <= 0) return `untouched by ${theme.name}`
  const stage = corruptionStage(theme, value)
  const depth = value >= MAX_CORRUPTION ? 'fully consumed' : value >= 3 ? 'deep in' : 'touched by'
  return `${depth} ${theme.name}${stage ? ` — ${stage}` : ''}`
}
