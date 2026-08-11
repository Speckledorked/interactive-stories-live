// src/lib/game/advancement.ts
// Organic, story-driven character advancement system
// NO manual level-ups or player-facing menus

import { Character } from '@prisma/client'
import { ARC_LENGTH_TURNS, slugifyCapabilityKey } from './capabilities'
import { boundAdvancementEntries } from './textAppend'
import { STRESS_EVOLUTION_THRESHOLD } from './stress'

/**
 * Stat usage tracking structure. lastGrowthTurn gates re-proposing a +1 for
 * the same stat within ARC_LENGTH_TURNS — without it, a stat that's crossed
 * the growth threshold would re-propose +1 on every future resolution that
 * uses it, throttled only by the PbtA sum/cap constraints silently
 * rejecting the proposal once the math can't fit.
 */
export interface StatUsage {
  [statKey: string]: {
    uses: number
    successes: number
    failures: number
    lastGrowthTurn?: number
  }
}

/**
 * Perk structure. Like Move, perks are AI-authored — grounded in what this
 * specific character has actually done in this specific campaign, not drawn
 * from a fixed list (an early version of this engine granted one of 4 fixed
 * templates by tag-frequency; that made every character in every campaign
 * converge on the same handful of perks regardless of genre or backstory).
 * id is derived server-side from name via buildPerkFromAI, never trusted
 * from the AI, so the same conceptual perk reported with slightly different
 * phrasing across scenes still dedupes correctly — same reasoning as Move.
 */
export interface Perk {
  id: string
  name: string
  description: string
  tags?: string[]
}

/**
 * Build a Perk from what the AI reports (name/description/tags) — the id is
 * always derived here, never taken from the AI. Mirrors buildMoveFromAI.
 */
export function buildPerkFromAI(aiPerk: { name: string; description: string; tags?: string[] }): Perk {
  return {
    id: slugifyCapabilityKey(aiPerk.name),
    name: aiPerk.name,
    description: aiPerk.description,
    tags: aiPerk.tags,
  }
}

/**
 * Move structure. Moves are rare, narratively-earned signature tricks —
 * distinct from capabilities (skill-tree systems the fiction reveals) and
 * perks (small bonuses from a repeated pattern of actions). id is derived
 * server-side from name via slugifyCapabilityKey, not trusted from the AI,
 * so the same conceptual move reported with slightly different phrasing
 * across scenes still dedupes correctly.
 */
export interface Move {
  id: string
  name: string
  trigger: string
  description: string
}

/**
 * Build a Move from what the AI reports (name/trigger/description) — the id
 * is always derived here, never taken from the AI, so the same conceptual
 * move dedupes correctly even if the AI phrases it slightly differently
 * across scenes.
 */
export function buildMoveFromAI(aiMove: { name: string; trigger: string; description: string }): Move {
  return {
    id: slugifyCapabilityKey(aiMove.name),
    name: aiMove.name,
    trigger: aiMove.trigger,
    description: aiMove.description
  }
}

/**
 * Organic growth instruction structure
 */
export interface OrganicGrowthInstruction {
  statIncreases: Array<{
    statKey: string
    delta: number
    reason: string
  }>
  newPerks: Perk[]
  newMoves: Move[]
}

/**
 * Per-arc grant guardrail for AI-authored perks and Abilities.
 *
 * Perks and Moves are the only two permanent, mechanically-live rewards the
 * AI authors freely (both feed `matched_signature_id` at roll time — see
 * resolution.ts's SIGNATURE_BONUS). Everything else the AI reports with a
 * lasting effect already has a deterministic ceiling independent of the
 * model behaving: stat growth is gated to once per arc per stat
 * (computeOrganicGrowth), capability proficiency by MAX_GROWTH_PER_ARC,
 * corruption by a hard +1/scene cap, standing by ±1/scene.
 *
 * Perks/moves had no such ceiling — the *only* thing asking the AI to keep
 * them rare was prompt text ("reserve for a genuine repeated pattern...
 * roughly once every several sessions"), and id-based dedup only stops the
 * SAME perk being re-granted, not a stream of different ones. A model that
 * ignores that instruction could hand out unlimited permanent +1s.
 *
 * Budgets are per ARC_LENGTH_TURNS window and counted from the advancement
 * log, which already stamps `turnNumber` on every grant — no new schema.
 * Moves are capped alongside perks (not more tightly) because a move is
 * already rarer in practice; the point here is a hard ceiling, not a
 * balance pass.
 */
export const MAX_PERKS_PER_ARC = 1
export const MAX_MOVES_PER_ARC = 1

/**
 * How many grants of a given kind fall inside the current arc window.
 *
 * A legacy entry with no `turnNumber` is deliberately NOT counted: we can't
 * prove it's recent, and silently consuming a character's budget over an
 * unprovable timestamp is the more punitive of the two failure modes. Every
 * live call site stamps turnNumber (see sceneResolver.ts), so this only
 * affects rows predating that.
 */
export function countGrantsInArc(
  log: AdvancementLog | null | undefined,
  type: 'perk_gained' | 'move_learned',
  currentTurn: number
): number {
  const entries = log?.entries
  if (!entries?.length) return 0
  return entries.filter(entry => {
    if (entry.type !== type) return false
    if (typeof entry.turnNumber !== 'number') return false
    return currentTurn - entry.turnNumber < ARC_LENGTH_TURNS
  }).length
}

/**
 * Whether this character's accumulated stress (see stress.ts) justifies
 * telling the AI it MAY offer a perk/move evolution this scene — a
 * transformation of something already on their sheet, framed as spiral
 * (obsessive/costly) or resilience (refined/stronger), rather than an
 * unrelated new bonus.
 *
 * Deliberately reuses the SAME perk/move arc budget every ordinary grant
 * already respects (countGrantsInArc/MAX_PERKS_PER_ARC/MAX_MOVES_PER_ARC)
 * rather than a second counter — an evolution IS a perk or move grant
 * mechanically (see sceneResolutionRequest.ts/scenePrompt.ts), just
 * narratively framed as change rather than addition. Eligible only when
 * at least one of the two channels has room this arc.
 */
export function isEvolutionEligible(
  stress: number,
  log: AdvancementLog | null | undefined,
  currentTurn: number
): boolean {
  if (stress < STRESS_EVOLUTION_THRESHOLD) return false
  const perksUsed = countGrantsInArc(log, 'perk_gained', currentTurn)
  const movesUsed = countGrantsInArc(log, 'move_learned', currentTurn)
  return perksUsed < MAX_PERKS_PER_ARC || movesUsed < MAX_MOVES_PER_ARC
}

/** Why a proposed perk/move didn't land. */
export type GrantSkipReason = 'duplicate' | 'arc_budget'

/**
 * What applyOrganicGrowth actually did — distinguishing the full updated
 * arrays (what to persist) from the grants that genuinely landed this call
 * (what to log). Before this split, the caller logged every *proposed*
 * perk/move, so a re-reported duplicate still incremented
 * totalPerksGained and wrote a phantom "gained" entry — which would also
 * have poisoned the arc budget above, since the budget counts log entries.
 */
export interface AppliedGrowth {
  updatedStats: any
  updatedPerks: Perk[]
  updatedMoves: Move[]
  grantedPerks: Perk[]
  grantedMoves: Move[]
  skippedPerks: Array<{ perk: Perk; reason: GrantSkipReason }>
  skippedMoves: Array<{ move: Move; reason: GrantSkipReason }>
}

/**
 * Recent action summary, used to update stat usage tracking
 */
export interface RecentAction {
  actionId: string
  statUsed?: string | null
  outcome?: 'success' | 'mixed' | 'failure'
}

/**
 * Advancement Log Entry
 * Records when and why a character advanced
 */
export interface AdvancementLogEntry {
  timestamp: string
  turnNumber?: number
  sceneId?: string
  type: 'stat_increase' | 'perk_gained' | 'move_learned'
  details: {
    statKey?: string
    oldValue?: number
    newValue?: number
    perkId?: string
    perkName?: string
    moveId?: string
    moveName?: string
    reason: string
  }
}

/**
 * Advancement Log
 * Full history of a character's growth
 */
export interface AdvancementLog {
  entries: AdvancementLogEntry[]
  totalStatIncreases: number
  totalPerksGained: number
  totalMovesLearned: number
}

/**
 * Record stat usage for a character
 * Updates the statUsage JSON field
 */
export function recordStatUsage(
  current: any,
  statKey: string,
  outcome: 'success' | 'mixed' | 'failure'
): StatUsage {
  const usage: StatUsage = current || {}

  if (!usage[statKey]) {
    usage[statKey] = { uses: 0, successes: 0, failures: 0 }
  }

  usage[statKey].uses++

  if (outcome === 'success' || outcome === 'mixed') {
    usage[statKey].successes++
  }
  if (outcome === 'failure') {
    usage[statKey].failures++
  }

  return usage
}

/**
 * Compute deterministic organic growth from character usage patterns —
 * stat increases only. Perks and Moves are NOT computed here: both are
 * AI-authored (organic_advancement.new_perks/new_moves), grounded in what
 * this specific character actually did in this specific campaign, rather
 * than assigned from a fixed engine-side list — see Perk's doc comment for
 * why. This function's only job is the one kind of growth that's genuinely
 * a flat numeric fact rather than invented content: a stat crossing its
 * usage/success threshold.
 *
 * currentTurn gates stat growth to at most once per ARC_LENGTH_TURNS per
 * stat (via each stat's statUsage.lastGrowthTurn) — the same arc cadence
 * capabilities.ts uses, so both growth systems pace at a comparable rate.
 *
 * Returns suggestions; does not apply them directly
 */
export function computeOrganicGrowth(
  character: Character,
  currentTurn: number
): OrganicGrowthInstruction {
  const instruction: OrganicGrowthInstruction = {
    statIncreases: [],
    newPerks: [],
    newMoves: []
  }

  const statUsage = (character.statUsage as any as StatUsage) || {}

  // Check for stat improvements based on usage
  for (const [statKey, usage] of Object.entries(statUsage)) {
    // Threshold: 10+ uses with at least 60% success rate
    if (usage.uses >= 10 && usage.successes / usage.uses >= 0.6) {
      // Already grew this stat within the current arc — the cumulative
      // usage counter never resets, so without this the same threshold
      // would re-propose +1 on every future resolution that uses this
      // stat until the PbtA sum/cap constraints start silently rejecting it.
      const lastGrowthTurn = usage.lastGrowthTurn ?? -Infinity
      if (currentTurn - lastGrowthTurn < ARC_LENGTH_TURNS) continue

      // Suggest a +1 increase (will be validated by applyOrganicGrowth)
      instruction.statIncreases.push({
        statKey,
        delta: 1,
        reason: `Consistent successful use of ${statKey} (${usage.successes}/${usage.uses} successes)`
      })

      // Only suggest one stat increase per growth event
      break
    }
  }

  return instruction
}

/**
 * Validate character stats according to PbtA rules
 * - Each stat must be between -2 and +3
 * - Sum of all stats must equal +2
 * - At most one stat can be >= 2
 */
export function validateStats(stats: Record<string, number>): { valid: boolean; error?: string } {
  if (!stats || Object.keys(stats).length === 0) {
    return { valid: false, error: 'Stats are required and cannot be empty' }
  }

  const statValues = Object.values(stats)

  // Check each stat is an integer between -2 and +3
  for (const [key, value] of Object.entries(stats)) {
    if (!Number.isInteger(value)) {
      return { valid: false, error: `Stat ${key} must be an integer` }
    }
    if (value < -2 || value > 3) {
      return { valid: false, error: `Stat ${key} must be between -2 and +3 (got ${value})` }
    }
  }

  // Check sum equals +2
  const sum = statValues.reduce((acc, val) => acc + val, 0)
  if (sum !== 2) {
    return { valid: false, error: `Total sum of stats must equal +2 (got ${sum})` }
  }

  // Check at most one stat >= 2
  const highStats = statValues.filter(v => v >= 2)
  if (highStats.length > 1) {
    return { valid: false, error: 'At most one stat can be +2 or higher' }
  }

  return { valid: true }
}

/**
 * Apply organic growth instructions to a character
 * Validates all changes and returns updated fields
 * Does NOT save to database - caller must do that
 */
export function applyOrganicGrowth(
  character: Character,
  instructions: OrganicGrowthInstruction,
  currentTurn: number
): AppliedGrowth {
  // Start with current values
  let stats = character.stats ? { ...(character.stats as any as Record<string, number>) } : {}
  let perks = character.perks ? [...(character.perks as any as Perk[])] : []
  let moves = character.moves ? [...(character.moves as any as Move[])] : []

  const grantedPerks: Perk[] = []
  const grantedMoves: Move[] = []
  const skippedPerks: Array<{ perk: Perk; reason: GrantSkipReason }> = []
  const skippedMoves: Array<{ move: Move; reason: GrantSkipReason }> = []

  // Apply stat increases
  for (const statIncrease of instructions.statIncreases) {
    const proposedStats = { ...stats }
    proposedStats[statIncrease.statKey] = (proposedStats[statIncrease.statKey] || 0) + statIncrease.delta

    // Validate the proposed change
    const validation = validateStats(proposedStats)
    if (validation.valid) {
      stats = proposedStats
      console.log(`✅ Applied stat increase: ${statIncrease.statKey} +${statIncrease.delta} (${statIncrease.reason})`)
    } else {
      console.warn(`⚠️ Skipped stat increase for ${statIncrease.statKey}: ${validation.error}`)
    }
  }

  // Remaining per-arc budget, read from what actually landed historically
  // (see countGrantsInArc / MAX_PERKS_PER_ARC).
  const log = (character.advancementLog as any as AdvancementLog) || null
  let perkBudget = Math.max(0, MAX_PERKS_PER_ARC - countGrantsInArc(log, 'perk_gained', currentTurn))
  let moveBudget = Math.max(0, MAX_MOVES_PER_ARC - countGrantsInArc(log, 'move_learned', currentTurn))

  // Apply new perks (deduplicate by id, then spend arc budget)
  for (const newPerk of instructions.newPerks) {
    if (perks.some(p => p.id === newPerk.id)) {
      skippedPerks.push({ perk: newPerk, reason: 'duplicate' })
      continue
    }
    if (perkBudget <= 0) {
      skippedPerks.push({ perk: newPerk, reason: 'arc_budget' })
      console.warn(`⚠️ Skipped perk "${newPerk.name}": per-arc grant budget exhausted`)
      continue
    }
    perks.push(newPerk)
    grantedPerks.push(newPerk)
    perkBudget--
    console.log(`✅ Granted perk: ${newPerk.name}`)
  }

  // Apply new moves (deduplicate by id, then spend arc budget)
  for (const newMove of instructions.newMoves) {
    if (moves.some(m => m.id === newMove.id)) {
      skippedMoves.push({ move: newMove, reason: 'duplicate' })
      continue
    }
    if (moveBudget <= 0) {
      skippedMoves.push({ move: newMove, reason: 'arc_budget' })
      console.warn(`⚠️ Skipped ability "${newMove.name}": per-arc grant budget exhausted`)
      continue
    }
    moves.push(newMove)
    grantedMoves.push(newMove)
    moveBudget--
    console.log(`✅ Granted move: ${newMove.name}`)
  }

  return {
    updatedStats: stats,
    updatedPerks: perks,
    updatedMoves: moves,
    grantedPerks,
    grantedMoves,
    skippedPerks,
    skippedMoves,
  }
}

/**
 * Initialize an empty advancement log
 */
export function createAdvancementLog(): AdvancementLog {
  return {
    entries: [],
    totalStatIncreases: 0,
    totalPerksGained: 0,
    totalMovesLearned: 0
  }
}

/**
 * Add a stat increase to the advancement log
 */
export function logStatIncrease(
  log: AdvancementLog,
  statKey: string,
  oldValue: number,
  newValue: number,
  reason: string,
  turnNumber?: number,
  sceneId?: string
): AdvancementLog {
  const entry: AdvancementLogEntry = {
    timestamp: new Date().toISOString(),
    turnNumber,
    sceneId,
    type: 'stat_increase',
    details: {
      statKey,
      oldValue,
      newValue,
      reason
    }
  }

  return {
    entries: boundAdvancementEntries([...log.entries, entry]),
    totalStatIncreases: log.totalStatIncreases + 1,
    totalPerksGained: log.totalPerksGained,
    totalMovesLearned: log.totalMovesLearned
  }
}

/**
 * Add a perk gain to the advancement log
 */
export function logPerkGained(
  log: AdvancementLog,
  perkId: string,
  perkName: string,
  reason: string,
  turnNumber?: number,
  sceneId?: string
): AdvancementLog {
  const entry: AdvancementLogEntry = {
    timestamp: new Date().toISOString(),
    turnNumber,
    sceneId,
    type: 'perk_gained',
    details: {
      perkId,
      perkName,
      reason
    }
  }

  return {
    entries: boundAdvancementEntries([...log.entries, entry]),
    totalStatIncreases: log.totalStatIncreases,
    totalPerksGained: log.totalPerksGained + 1,
    totalMovesLearned: log.totalMovesLearned
  }
}

/**
 * Add a move learned to the advancement log
 */
export function logMoveLearned(
  log: AdvancementLog,
  moveId: string,
  moveName: string,
  reason: string,
  turnNumber?: number,
  sceneId?: string
): AdvancementLog {
  const entry: AdvancementLogEntry = {
    timestamp: new Date().toISOString(),
    turnNumber,
    sceneId,
    type: 'move_learned',
    details: {
      moveId,
      moveName,
      reason
    }
  }

  return {
    entries: boundAdvancementEntries([...log.entries, entry]),
    totalStatIncreases: log.totalStatIncreases,
    totalPerksGained: log.totalPerksGained,
    totalMovesLearned: log.totalMovesLearned + 1
  }
}

/**
 * Get recent advancement entries (last N)
 */
export function getRecentAdvancements(log: AdvancementLog, limit: number = 10): AdvancementLogEntry[] {
  return log.entries.slice(-limit)
}

/**
 * Get all advancements of a specific type
 */
export function getAdvancementsByType(
  log: AdvancementLog,
  type: 'stat_increase' | 'perk_gained' | 'move_learned'
): AdvancementLogEntry[] {
  return log.entries.filter(entry => entry.type === type)
}

/**
 * Format advancement log entry for display
 */
export function formatAdvancementEntry(entry: AdvancementLogEntry): string {
  const date = new Date(entry.timestamp).toLocaleDateString()
  const turnInfo = entry.turnNumber ? ` (Turn ${entry.turnNumber})` : ''

  switch (entry.type) {
    case 'stat_increase':
      return `${date}${turnInfo}: ${entry.details.statKey} increased from ${entry.details.oldValue} to ${entry.details.newValue} - ${entry.details.reason}`
    case 'perk_gained':
      return `${date}${turnInfo}: Gained perk "${entry.details.perkName}" - ${entry.details.reason}`
    case 'move_learned':
      return `${date}${turnInfo}: Learned move "${entry.details.moveName || entry.details.moveId}" - ${entry.details.reason}`
    default:
      return `${date}${turnInfo}: Unknown advancement type`
  }
}
