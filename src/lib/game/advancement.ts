// src/lib/game/advancement.ts
// Organic, story-driven character advancement system
// NO manual level-ups or player-facing menus

import { Character } from '@prisma/client'

/**
 * Stat usage tracking structure
 */
export interface StatUsage {
  [statKey: string]: {
    uses: number
    successes: number
    failures: number
  }
}

/**
 * Perk structure
 */
export interface Perk {
  id: string
  name: string
  description: string
  tags?: string[]
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
  newMoves: string[]
}

/**
 * Recent action summary for growth computation
 */
export interface RecentAction {
  actionId: string
  tags?: string[]
  statUsed?: string | null
  outcome?: 'success' | 'mixed' | 'failure'
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
 * Compute organic growth based on character usage patterns
 * This is a heuristic system that looks for patterns in:
 * - Repeated stat usage with success
 * - Action tags suggesting training or practice
 * - Total experience accumulated
 *
 * Returns suggestions; does not apply them directly
 */
export function computeOrganicGrowth(
  character: Character,
  recentActions: RecentAction[]
): OrganicGrowthInstruction {
  const instruction: OrganicGrowthInstruction = {
    statIncreases: [],
    newPerks: [],
    newMoves: []
  }

  const statUsage = (character.statUsage as StatUsage) || {}
  const existingPerks = (character.perks as Perk[]) || []

  // Count tag frequencies in recent actions
  const tagCounts: Record<string, number> = {}
  for (const action of recentActions) {
    if (action.tags) {
      for (const tag of action.tags) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1
      }
    }
  }

  // 1. Check for stat improvements based on usage
  for (const [statKey, usage] of Object.entries(statUsage)) {
    // Threshold: 10+ uses with at least 60% success rate
    if (usage.uses >= 10 && usage.successes / usage.uses >= 0.6) {
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

  // 2. Check for perk awards based on tags
  // Training/practice perks
  if (tagCounts['training'] >= 3 || tagCounts['practice'] >= 3) {
    const hasDisciplinedPerk = existingPerks.some(p => p.id === 'disciplined')
    if (!hasDisciplinedPerk) {
      instruction.newPerks.push({
        id: 'disciplined',
        name: 'Disciplined',
        description: 'Your training shows. +1 forward when you have time to prepare.',
        tags: ['training', 'bonus']
      })
    }
  }

  // Combat/fighting perks
  if (tagCounts['combat'] >= 4 || tagCounts['fighting'] >= 4) {
    const hasBattleHardenedPerk = existingPerks.some(p => p.id === 'battle_hardened')
    if (!hasBattleHardenedPerk) {
      instruction.newPerks.push({
        id: 'battle_hardened',
        name: 'Battle Hardened',
        description: 'You\'ve seen real combat. Take +1 ongoing when fighting multiple foes.',
        tags: ['combat', 'bonus']
      })
    }
  }

  // Stealth/spying perks
  if (tagCounts['stealth'] >= 3 || tagCounts['spying'] >= 3 || tagCounts['infiltration'] >= 3) {
    const hasShadowOperatorPerk = existingPerks.some(p => p.id === 'shadow_operator')
    if (!hasShadowOperatorPerk) {
      instruction.newPerks.push({
        id: 'shadow_operator',
        name: 'Shadow Operator',
        description: 'You know how to move unseen. When you act under pressure to avoid detection, take +1.',
        tags: ['stealth', 'bonus']
      })
    }
  }

  // Social/investigation perks
  if (tagCounts['investigation'] >= 3 || tagCounts['social'] >= 3) {
    const hasKeenEyePerk = existingPerks.some(p => p.id === 'keen_eye')
    if (!hasKeenEyePerk) {
      instruction.newPerks.push({
        id: 'keen_eye',
        name: 'Keen Eye',
        description: 'You notice things others miss. +1 when reading a situation or person.',
        tags: ['investigation', 'bonus']
      })
    }
  }

  // Limit to 1 new perk per growth event
  if (instruction.newPerks.length > 1) {
    instruction.newPerks = [instruction.newPerks[0]]
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
  updatedMoves: string[]
} {
  // Start with current values
  let stats = character.stats ? { ...(character.stats as Record<string, number>) } : {}
  let perks = character.perks ? [...(character.perks as Perk[])] : []
  let moves = character.moves ? [...character.moves] : []

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

  // Apply new moves (deduplicate)
  for (const moveId of instructions.newMoves) {
    if (!moves.includes(moveId)) {
      moves.push(moveId)
      console.log(`✅ Granted move: ${moveId}`)
    }
  }

  return {
    updatedStats: stats,
    updatedPerks: perks,
    updatedMoves: moves
  }
}
