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

/**
 * Pick the faction this crisis should fall on, given who it has recently
 * fallen on already.
 *
 * This is the one place the deterministic simulation reads its OWN history
 * back to make a decision, rather than deciding purely from a snapshot of
 * current state. Every other tick decision — faction goals, war momentum,
 * clock advancement, pacing — is a pure function of right-now, which means
 * the world has no way to notice it is repeating itself. The most visible
 * symptom is here: the strongest faction stays the strongest, so
 * `pickMostThreateningFaction` alone hands every single milestone crisis to
 * the same faction forever, and "the world moves against you" degrades into
 * the same organisation menacing the party every twenty scenes.
 *
 * A recently-used faction is demoted, not banned: if every candidate is
 * recent (a two-faction campaign, say), this still returns the most
 * threatening one rather than nothing. Escalating the usual suspect is a
 * far better failure mode than a milestone that quietly does nothing.
 *
 * Pure — the caller supplies the history.
 */
export function pickCrisisFaction<T extends FactionThreatSnapshot>(
  factions: T[],
  recentCrisisFactionIds: string[]
): T | null {
  if (factions.length === 0) return null

  const recent = new Set(recentCrisisFactionIds)
  const unused = factions.filter(f => !recent.has(f.id))

  // Prefer a faction that hasn't had its turn as the crisis lately; fall
  // back to the full field once everyone has.
  return pickMostThreateningFaction(unused.length > 0 ? unused : factions)
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

/**
 * WorldEvent.type written when a milestone crisis fires, and read back by
 * the next one (see pickCrisisFaction). Kept here beside the decision
 * function so the writer and reader can't drift apart.
 */
export const CRISIS_WORLD_EVENT_TYPE = 'faction.crisis'

/**
 * How many past crises count as "recent" for demotion purposes. Small on
 * purpose: with a handful of factions, a longer memory would demote
 * everyone and collapse straight back to pure threat ranking.
 */
export const RECENT_CRISIS_LOOKBACK = 3
