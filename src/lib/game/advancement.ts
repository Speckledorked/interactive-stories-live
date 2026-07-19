// src/lib/game/advancement.ts
// Organic, story-driven character advancement system
// NO manual level-ups or player-facing menus

import { Character } from '@prisma/client'
import { ARC_LENGTH_TURNS, slugifyCapabilityKey } from './capabilities'

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
  instructions: OrganicGrowthInstruction
): {
  updatedStats: any
  updatedPerks: any
  updatedMoves: Move[]
} {
  // Start with current values
  let stats = character.stats ? { ...(character.stats as any as Record<string, number>) } : {}
  let perks = character.perks ? [...(character.perks as any as Perk[])] : []
  let moves = character.moves ? [...(character.moves as any as Move[])] : []

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

  // Apply new perks (deduplicate by id)
  for (const newPerk of instructions.newPerks) {
    const exists = perks.some(p => p.id === newPerk.id)
    if (!exists) {
      perks.push(newPerk)
      console.log(`✅ Granted perk: ${newPerk.name}`)
    }
  }

  // Apply new moves (deduplicate by id)
  for (const newMove of instructions.newMoves) {
    const exists = moves.some(m => m.id === newMove.id)
    if (!exists) {
      moves.push(newMove)
      console.log(`✅ Granted move: ${newMove.name}`)
    }
  }

  return {
    updatedStats: stats,
    updatedPerks: perks,
    updatedMoves: moves
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
    entries: [...log.entries, entry],
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
    entries: [...log.entries, entry],
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
    entries: [...log.entries, entry],
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
