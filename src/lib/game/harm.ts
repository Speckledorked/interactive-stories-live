// src/lib/game/harm.ts
// Harm and Conditions System
// Implements a 6-segment harm track and condition management

/**
 * Harm Track States
 * 0-3: Fine (no mechanical penalties)
 * 4-5: Impaired (-1 to all rolls)
 * 6: Taken Out (unconscious, captured, or dying)
 */
export type HarmLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6

/**
 * Condition Categories
 */
export type ConditionCategory = 'Physical' | 'Emotional' | 'Special'

/**
 * A character condition
 */
export interface Condition {
  id: string
  name: string
  category: ConditionCategory
  description: string
  mechanicalEffect?: string // e.g., "-1 to social rolls"
  appliedAt?: number // Turn number when applied
}

/**
 * Full harm state for a character
 */
export interface HarmState {
  currentHarm: HarmLevel
  conditions: Condition[]
  deathSaves?: number // For death spiral mechanics
  permanentInjuries?: string[]
}

/**
 * Get the harm status text for UI display
 */
export function getHarmStatus(harm: HarmLevel): {
  status: 'Fine' | 'Impaired' | 'Taken Out'
  description: string
  penalty: number
} {
  if (harm <= 3) {
    return {
      status: 'Fine',
      description: 'No significant injuries',
      penalty: 0
    }
  } else if (harm <= 5) {
    return {
      status: 'Impaired',
      description: 'Wounded and struggling (-1 to all rolls)',
      penalty: -1
    }
  } else {
    return {
      status: 'Taken Out',
      description: 'Unconscious, captured, or dying',
      penalty: -999 // Cannot act
    }
  }
}

/**
 * Apply harm to a character
 * Returns new harm level (capped at 6) and any automatic conditions
 */
export function applyHarm(
  currentHarm: HarmLevel,
  damage: number,
  armorReduction: number = 0
): {
  newHarm: HarmLevel
  autoConditions: Condition[]
  message: string
} {
  const actualDamage = Math.max(0, damage - armorReduction)
  const newHarmValue = Math.min(6, currentHarm + actualDamage) as HarmLevel

  const autoConditions: Condition[] = []
  let message = `Takes ${actualDamage} harm`

  // Check for threshold crossings
  if (currentHarm <= 3 && newHarmValue >= 4) {
    message += ' and becomes Impaired (-1 to all rolls)'
  }

  if (newHarmValue === 6) {
    message += ' and is Taken Out!'
    autoConditions.push({
      id: `taken_out_${Date.now()}`,
      name: 'Taken Out',
      category: 'Physical',
      description: 'Unconscious, captured, or dying. Cannot act until stabilized.',
      mechanicalEffect: 'Cannot take actions'
    })
  }

  return {
    newHarm: newHarmValue,
    autoConditions,
    message
  }
}

/**
 * Heal harm
 * Cannot heal below 0, and may require conditions to be cleared first
 */
export function healHarm(
  currentHarm: HarmLevel,
  healing: number
): {
  newHarm: HarmLevel
  message: string
} {
  const newHarmValue = Math.max(0, currentHarm - healing) as HarmLevel

  let message = `Heals ${healing} harm`

  // Check for threshold crossings
  if (currentHarm === 6 && newHarmValue < 6) {
    message += ' and is no longer Taken Out'
  }

  if (currentHarm >= 4 && newHarmValue <= 3) {
    message += ' and is no longer Impaired'
  }

  return {
    newHarm: newHarmValue,
    message
  }
}

/**
 * Mark a condition on a character
 */
export function markCondition(
  conditions: Condition[],
  newCondition: Condition
): {
  updatedConditions: Condition[]
  message: string
} {
  // Check if condition already exists
  const existingIndex = conditions.findIndex(c => c.id === newCondition.id)

  if (existingIndex >= 0) {
    // Update existing condition
    const updated = [...conditions]
    updated[existingIndex] = newCondition
    return {
      updatedConditions: updated,
      message: `Updated condition: ${newCondition.name}`
    }
  } else {
    // Add new condition
    return {
      updatedConditions: [...conditions, newCondition],
      message: `Marked with condition: ${newCondition.name}`
    }
  }
}

/**
 * Clear a condition from a character
 */
export function clearCondition(
  conditions: Condition[],
  conditionId: string
): {
  updatedConditions: Condition[]
  clearedCondition?: Condition
  message: string
} {
  const index = conditions.findIndex(c => c.id === conditionId)

  if (index === -1) {
    return {
      updatedConditions: conditions,
      message: 'Condition not found'
    }
  }

  const clearedCondition = conditions[index]
  const updatedConditions = conditions.filter(c => c.id !== conditionId)

  return {
    updatedConditions,
    clearedCondition,
    message: `Cleared condition: ${clearedCondition.name}`
  }
}

/**
 * Get total penalty from all conditions
 */
export function getTotalConditionPenalty(conditions: Condition[]): number {
  let penalty = 0

  for (const condition of conditions) {
    // Parse mechanical effects for penalties
    const effect = condition.mechanicalEffect?.toLowerCase() || ''
    const match = effect.match(/-(\d+)/)
    if (match) {
      penalty += parseInt(match[1])
    }
  }

  return penalty
}

/**
 * Check if a character can act
 */
export function canAct(harm: HarmLevel, conditions: Condition[]): boolean {
  // Cannot act if taken out
  if (harm >= 6) {
    return false
  }

  // Cannot act if any condition prevents it
  const hasIncapacitatingCondition = conditions.some(c =>
    c.mechanicalEffect?.toLowerCase().includes('cannot take actions') ||
    c.mechanicalEffect?.toLowerCase().includes('cannot act')
  )

  return !hasIncapacitatingCondition
}

/**
 * Initialize default harm state for a new character
 */
export function createDefaultHarmState(): HarmState {
  return {
    currentHarm: 0,
    conditions: [],
    deathSaves: 0,
    permanentInjuries: []
  }
}

/**
 * Common condition templates
 */
export const COMMON_CONDITIONS: Record<string, Omit<Condition, 'id' | 'appliedAt'>> = {
  // Physical Conditions
  bleeding: {
    name: 'Bleeding',
    category: 'Physical',
    description: 'Losing blood rapidly. Takes 1 harm at the start of each turn unless treated.',
    mechanicalEffect: '1 harm per turn'
  },
  stunned: {
    name: 'Stunned',
    category: 'Physical',
    description: 'Dazed and disoriented.',
    mechanicalEffect: '-1 to all rolls until end of scene'
  },
  poisoned: {
    name: 'Poisoned',
    category: 'Physical',
    description: 'Toxins coursing through the body.',
    mechanicalEffect: '-1 to physical rolls'
  },
  broken_limb: {
    name: 'Broken Limb',
    category: 'Physical',
    description: 'A limb is fractured or broken.',
    mechanicalEffect: '-2 to rolls using that limb'
  },

  // Emotional Conditions
  terrified: {
    name: 'Terrified',
    category: 'Emotional',
    description: 'Overwhelmed by fear.',
    mechanicalEffect: '-2 to rolls against the source of fear'
  },
  enraged: {
    name: 'Enraged',
    category: 'Emotional',
    description: 'Consumed by anger.',
    mechanicalEffect: '+1 to combat rolls, -2 to social rolls'
  },
  despair: {
    name: 'Despair',
    category: 'Emotional',
    description: 'Lost all hope.',
    mechanicalEffect: '-1 to all rolls'
  },
  confused: {
    name: 'Confused',
    category: 'Emotional',
    description: 'Cannot think clearly.',
    mechanicalEffect: '-1 to investigation and planning rolls'
  },

  // Special Conditions
  cursed: {
    name: 'Cursed',
    category: 'Special',
    description: 'Under a supernatural curse.',
    mechanicalEffect: 'Specific effects determined by curse'
  },
  marked: {
    name: 'Marked',
    category: 'Special',
    description: 'Marked by a powerful entity.',
    mechanicalEffect: 'Can be tracked and found by the entity'
  },
  unstable: {
    name: 'Unstable',
    category: 'Special',
    description: 'Reality warps around you.',
    mechanicalEffect: 'Roll 1d6 at start of turn: 1-2 = random effect'
  }
}

/**
 * Create a condition from a template
 */
export function createConditionFromTemplate(
  templateKey: keyof typeof COMMON_CONDITIONS,
  turnNumber?: number
): Condition {
  const template = COMMON_CONDITIONS[templateKey]
  return {
    id: `${templateKey}_${Date.now()}`,
    ...template,
    appliedAt: turnNumber
  }
}

/**
 * Death save mechanics
 * When at 6 harm, character must make death saves
 */
export function makeDeathSave(
  currentDeathSaves: number,
  success: boolean
): {
  newDeathSaves: number
  status: 'stable' | 'dying' | 'dead'
  message: string
} {
  let newDeathSaves = currentDeathSaves

  if (success) {
    newDeathSaves = Math.max(0, currentDeathSaves - 1)
    if (newDeathSaves === 0) {
      return {
        newDeathSaves,
        status: 'stable',
        message: 'Death save succeeded! Character stabilizes.'
      }
    }
    return {
      newDeathSaves,
      status: 'dying',
      message: `Death save succeeded. ${newDeathSaves} more needed to stabilize.`
    }
  } else {
    newDeathSaves = currentDeathSaves + 1
    if (newDeathSaves >= 3) {
      return {
        newDeathSaves,
        status: 'dead',
        message: 'Death save failed. Character dies.'
      }
    }
    return {
      newDeathSaves,
      status: 'dying',
      message: `Death save failed. ${3 - newDeathSaves} failures until death.`
    }
  }
}

/**
 * Validate harm state
 */
export function validateHarmState(state: any): state is HarmState {
  if (!state || typeof state !== 'object') {
    return false
  }

  const harm = state.currentHarm
  if (typeof harm !== 'number' || harm < 0 || harm > 6) {
    return false
  }

  if (!Array.isArray(state.conditions)) {
    return false
  }

  return true
}
