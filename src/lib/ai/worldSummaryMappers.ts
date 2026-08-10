// src/lib/ai/worldSummaryMappers.ts
// Shared entity -> world_summary field mapping, used by both world-summary
// builders in worldState.ts (buildOptimizedWorldSummary and
// buildWorldSummaryForAI). Those two builders differ in how they FETCH and
// FILTER entities (one applies location/threat relevance filtering and a
// compressed timeline, the other doesn't), but once each has its own
// candidate list, the actual shape handed to the AI was identical,
// independently duplicated in both places. This file is that shared shape.
//
// Deliberately does NOT own the differences between the two builders:
// quests are capped in one builder and not the other (an existing,
// intentional-or-not asymmetry this refactor preserves rather than
// "fixing"), and recent_timeline_events comes from two genuinely different
// sources (a compressed digest vs. a raw recent-events fetch) — neither of
// those is duplicated logic, so neither lives here.

import { capForPrompt } from './contextManager'
import { describeStat, describeThreatLevel, describeWarMomentum } from './qualitativeStats'
import { summarizeCapabilities } from '@/lib/game/capabilities'
import { parseKnowledgeState } from '@/lib/game/knowledge'
import { inventoryValue, describeWealth } from '@/lib/game/itemValue'
import { summarizeDebts } from '@/lib/game/debts'
import { summarizeStandings } from '@/lib/game/standing'
import { parseFactionRelationships } from '@/lib/game/tick/types'

// Depth-hardening #37 (see README): hard per-category caps on the live
// world-state payload, applied via capForPrompt — a backstop against
// unbounded prompt/token growth in a maximally active long campaign. Under
// each cap, nothing changes; only an excess triggers priority-ordered
// trimming.
export const MAX_NPCS_IN_PROMPT = 15
export const MAX_FACTIONS_IN_PROMPT = 10
export const MAX_LOCATIONS_IN_PROMPT = 12
export const MAX_CLOCKS_IN_PROMPT = 10
export const MAX_QUESTS_IN_PROMPT = 8

/**
 * Phase 9 NPC society: resolve NPC.socialTies into AI-facing lines, naming
 * only OTHER discovered NPCs — fog of war applies to social ties exactly
 * like every other NPC-facing field the prompt builders below already gate.
 */
function describeNpcSocialTies(rawTies: unknown, discoveredNpcNameById: Map<string, string>): string[] {
  const ties = parseFactionRelationships(rawTies)
  const lines: string[] = []
  for (const [otherId, tie] of Object.entries(ties)) {
    const name = discoveredNpcNameById.get(otherId)
    if (!name) continue
    lines.push(`${tie.type === 'ALLY' ? 'ally' : 'rival'}: ${name}`)
  }
  return lines
}

/**
 * PbtA-style GM-facing flavor for a significant NPC (threat archetype,
 * what drives them, custom moves they can trigger) — set by admins/AI at
 * creation but previously never read by anything, so an NPC built as a
 * "grotesque" with real impulses/moves narrated exactly like a blank one.
 * Only returns keys that are actually set, so the vast majority of minor
 * NPCs (which never populate these) don't bloat every prompt with empty
 * arrays/nulls.
 */
function npcFlavorFields(n: { threat: string | null; impulses: string[]; moves: string[] }) {
  const fields: { threat?: string; impulses?: string[]; moves?: string[] } = {}
  if (n.threat) fields.threat = n.threat
  if (n.impulses.length > 0) fields.impulses = n.impulses
  if (n.moves.length > 0) fields.moves = n.moves
  return fields
}

/**
 * Last appended beat of a quest's progress log — the prompt only needs
 * "where this quest currently stands", not its whole history.
 */
function lastProgressBeat(progressLog: string | null): string | null {
  if (!progressLog) return null
  const lines = progressLog.split('\n').map(l => l.trim()).filter(Boolean)
  return lines.length > 0 ? lines[lines.length - 1] : null
}

export function mapCharactersForPrompt(characters: any[]) {
  return characters.map(c => ({
    id: c.id,
    name: c.name,
    description: c.description,
    // Permanent/lasting changes the fiction has already written onto this
    // character (scars, mutations, trauma, growth) — previously written
    // by pc_changes.appearance_changes/personality_changes but never fed
    // back into any prompt, so the narrator that wrote a scar was never
    // told about it again. Read here exactly like description/backstory.
    appearance: c.appearance,
    personality: c.personality,
    stats: c.stats,
    backstory: c.backstory,
    goals: c.goals,
    location: c.currentLocation,
    harm: c.harm,
    conditions: c.conditions,
    moves: c.moves,
    statUsage: c.statUsage,
    perks: c.perks,
    inventory: c.inventory,
    equipment: c.equipment,
    resources: c.resources,
    relationships: c.relationships,
    consequences: c.consequences,
    // Knowledge-relative sheet: qualitative bands + known-domains only —
    // raw proficiency numbers never reach a prompt (fog of war inward).
    origin_familiarity: c.originFamiliarity,
    capabilities: summarizeCapabilities(c.capabilities),
    // Structured, permanent declarative knowledge (#173/#174) — distinct
    // from capabilities above (system existence + proficiency). See
    // lib/game/knowledge.ts.
    known_concepts: parseKnowledgeState(c.knownConcepts).concepts,
    // Open favors, both directions — the AI's leverage currency, and now
    // a real roll modifier (see debtModifier in lib/game/debts.ts).
    debts: summarizeDebts(c.debts),
    // Qualitative carried wealth (#44/#47). A band, never a number, the
    // same discipline capabilities and corruption already follow — it
    // tells the narrator whether these are people who can buy their way
    // out of trouble without handing them a price list.
    carried_wealth: describeWealth(inventoryValue(((c.inventory as any)?.items) || [])),
    // Social position with discovered active factions, qualitatively.
    standings: summarizeStandings(c.factionStandings)
  }))
}

/**
 * Only relevant, discovered NPCs — fog of war: relevance alone isn't
 * enough, the party has to have actually encountered them. `discoveredNpcs`
 * is already capForPrompt'd by the caller (which also logs its length
 * against the uncapped roster), so this is the field shape only.
 */
export function mapNpcsForPrompt(discoveredNpcs: any[], discoveredNpcNameById: Map<string, string>) {
  return discoveredNpcs.map(n => ({
    id: n.id,
    name: n.name,
    description: n.description,
    goals: n.goals,
    relationship: n.relationship,
    importance: n.importance,
    // Cross-reference against the factions array below by id for the
    // faction's name/goal — kept as a bare id here rather than joined, to
    // avoid duplicating faction data into every affiliated NPC.
    factionId: n.factionId,
    factionRole: n.factionRole,
    // Phase 9 NPC society: this NPC's own web of allies/rivals.
    social_ties: describeNpcSocialTies(n.socialTies, discoveredNpcNameById),
    // PbtA GM-facing flavor (threat archetype, drives, custom moves) —
    // only present for NPCs where it's actually set (see npcFlavorFields).
    ...npcFlavorFields(n)
  }))
}

/**
 * Only relevant, discovered factions. Numeric stats are deliberately
 * qualitative here, not exact — the deterministic tick needs the real
 * numbers and reads them straight from Prisma; this prompt is narration
 * only, and an exact "resources: 73" is trivial for the AI to blurt out
 * as something no player could know in-fiction. `discoveredFactions` is
 * already capForPrompt'd by the caller, same reasoning as mapNpcsForPrompt.
 */
export function mapFactionsForPrompt(discoveredFactions: any[]) {
  return discoveredFactions.map(f => ({
    id: f.id,
    name: f.name,
    goals: f.goals,
    currentPlan: f.currentPlan,
    threat_level: describeThreatLevel(f.threatLevel),
    resources: describeStat(f.resources),
    influence: describeStat(f.influence),
    // World Sim Phase 6: set only when a player character leads this
    // faction — see the PLAYER-LED FACTIONS prompt instruction.
    leader_character_id: f.leaderCharacterId
  }))
}

/**
 * capForPrompt: contested locations are the ones actually worth narrating
 * in a crowded world — kept preferentially if there's an excess.
 */
export function mapLocationsForPrompt(locations: any[], discoveredFactionIds: Set<string>) {
  return capForPrompt(locations, MAX_LOCATIONS_IN_PROMPT, l => (l.isContested ? 1 : 0)).map(l => ({
    name: l.name,
    description: l.description || '',
    type: l.locationType || 'unknown',
    // World Sim Phase 1: persistent weather, ticked independently of the
    // player. Reference this in narration instead of inventing weather.
    weather: l.weather,
    weather_severity: l.weatherSeverity,
    // World Sim Phase 4: cross-reference owner_faction_id against the
    // factions array for the controlling faction's name — narrate control
    // and contested status from this, don't invent your own map.
    // Fog of war: null if the owner isn't discovered — territory doesn't
    // reveal a faction's existence just because it's mapped.
    owner_faction_id: l.ownerFactionId && discoveredFactionIds.has(l.ownerFactionId) ? l.ownerFactionId : null,
    is_contested: l.isContested
  }))
}

/**
 * capForPrompt: clocks closest to firing are the most narratively urgent —
 * kept preferentially if there's an excess.
 */
export function mapClocksForPrompt(clocks: any[]) {
  return capForPrompt(clocks, MAX_CLOCKS_IN_PROMPT, cl => cl.maxTicks > 0 ? cl.currentTicks / cl.maxTicks : 0).map(cl => ({
    id: cl.id,
    name: cl.name,
    current_ticks: cl.currentTicks,
    max_ticks: cl.maxTicks,
    description: cl.description || '',
    consequence: cl.consequence || ''
  }))
}

/**
 * Quest item shape only — deliberately NOT capping here. The two builders
 * disagree on whether quests get capForPrompt'd before reaching this
 * (buildWorldSummaryForAI does, buildOptimizedWorldSummary doesn't); that
 * asymmetry predates this refactor and is preserved by leaving the capping
 * decision to each call site rather than baking one choice in here.
 */
export function mapQuestsForPrompt(quests: any[]) {
  return quests.map(q => ({
    name: q.name,
    description: q.description,
    objective: q.objective,
    given_by: q.givenBy,
    recent_progress: lastProgressBeat(q.progressLog)
  }))
}

/**
 * World Sim Phase 5: sustained conflicts — only ones where both sides are
 * discovered; the party can't hear about a war between two factions
 * they've never encountered. Coalitions: ally counts only include
 * discovered factions, same fog-of-war rule as everything else here — a
 * hidden faction joining a known war doesn't get outed by it.
 */
export function mapWarsForPrompt(
  activeWars: any[],
  allFactions: any[],
  discoveredFactionIds: Set<string>,
  currentTurnNumber: number
) {
  return activeWars
    .filter(w => discoveredFactionIds.has(w.attackerFactionId) && discoveredFactionIds.has(w.defenderFactionId))
    .map(w => {
      const discoveredParticipants = w.participants.filter((p: any) => p.faction.isDiscovered)
      const attackerAllies = discoveredParticipants.filter((p: any) => p.side === 'ATTACKER' && p.factionId !== w.attackerFactionId).length
      const defenderAllies = discoveredParticipants.filter((p: any) => p.side === 'DEFENDER' && p.factionId !== w.defenderFactionId).length
      return {
        name: w.name,
        attacker: allFactions.find(f => f.id === w.attackerFactionId)?.name || 'Unknown',
        defender: allFactions.find(f => f.id === w.defenderFactionId)?.name || 'Unknown',
        attacker_allies: attackerAllies,
        defender_allies: defenderAllies,
        momentum: describeWarMomentum(w.momentum),
        turns_elapsed: currentTurnNumber - w.startedTurn
      }
    })
}
