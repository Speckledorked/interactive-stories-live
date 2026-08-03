// src/lib/game/tick/chronicleTypes.ts
// Shared shape between chronicleContext.ts (gathers it) and
// lib/ai/chronicleNarration.ts (consumes it) — kept in a small standalone
// file so the AI-calling module doesn't need to import from lib/game and
// vice versa isn't required either.

export interface ChronicleNarrationInput {
  campaignTitle: string
  universe: string
  tension: number
  phase: string | null
  weather: { locationName: string; condition: string; severity: number } | null
  factionSignals: Array<{
    name: string
    archetype: string
    goal: string
    stability: number
    threatLevel: number
    currentPlan: string | null
  }>
  activeWars: Array<{ name: string; attackerName: string; defenderName: string; momentum: number; status: string }>
  recentEvents: Array<{ title: string; summaryPublic: string | null }>
}

// Plain-data snapshot of the same signals above, for the lobby's
// "World at a Glance" tile row — no prose, just the raw facts a
// glanceable card can render directly. Derived from
// ChronicleNarrationInput by deriveChronicleGlance (chronicleContext.ts).
export interface ChronicleGlance {
  weatherLabel: string | null
  topFaction: { name: string; threatLevel: number } | null
  activeConflictCount: number
  recentEventCount: number
}
