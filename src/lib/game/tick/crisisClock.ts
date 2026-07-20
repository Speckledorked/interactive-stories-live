// src/lib/game/tick/crisisClock.ts
// Deterministic "crisis" escalation triggered by a campaign milestone (see
// campaignMilestone.ts) - picks the single most threatening active
// faction and either escalates its existing plan or ignites a new one.
// No AI call: a crisis reads as a mechanical inevitability the world
// itself produced, not an improvised flourish - matching how clock
// advancement and ambition outcomes elsewhere in this engine are
// deterministic given the faction's real stats, not narrated freely.

export interface FactionThreatSnapshot {
  id: string
  name: string
  threatLevel: number
  military: number
  resources: number
}

/**
 * Highest threatLevel wins; ties broken by military+resources (a bigger,
 * better-resourced faction is the more credible threat at equal
 * threatLevel), then by id for full determinism. Pure.
 */
export function pickMostThreateningFaction<T extends FactionThreatSnapshot>(factions: T[]): T | null {
  if (factions.length === 0) return null
  return factions.slice().sort((a, b) => {
    if (b.threatLevel !== a.threatLevel) return b.threatLevel - a.threatLevel
    const strengthA = a.military + a.resources
    const strengthB = b.military + b.resources
    if (strengthB !== strengthA) return strengthB - strengthA
    return a.id.localeCompare(b.id)
  })[0]
}

export interface CrisisClockSnapshot {
  currentTicks: number
  maxTicks: number
}

export type CrisisEscalationDecision =
  | { action: 'escalate'; newTicks: number }
  | { action: 'spawn'; spawnMaxTicks: number; spawnStartTicks: number }

// Shorter than a default ambition clock so a milestone crisis reads as
// urgent, and starts already partway advanced - a milestone crisis begins
// mid-escalation, not from zero.
const CRISIS_SPAWN_MAX_TICKS = 6
const CRISIS_SPAWN_START_TICKS = 2

/**
 * Decide how to escalate the crisis: if the threatening faction already
 * has an active clock tied to it, jump it forward by half its remaining
 * ticks (rounded up, minimum 1) rather than completing it outright - a
 * milestone crisis raises the stakes, it doesn't unilaterally end the
 * threat. Otherwise, spawn a new clock already partway advanced. Pure.
 */
export function decideCrisisEscalation(existingClock: CrisisClockSnapshot | null): CrisisEscalationDecision {
  if (existingClock) {
    const remaining = existingClock.maxTicks - existingClock.currentTicks
    const jump = Math.max(1, Math.ceil(remaining / 2))
    return { action: 'escalate', newTicks: Math.min(existingClock.currentTicks + jump, existingClock.maxTicks) }
  }
  return { action: 'spawn', spawnMaxTicks: CRISIS_SPAWN_MAX_TICKS, spawnStartTicks: CRISIS_SPAWN_START_TICKS }
}
