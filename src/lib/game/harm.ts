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

// ============================================================================
// PHASE 12.3: DEATH AND CONSEQUENCE RULES
// ============================================================================

/**
 * Permanent Injury
 * These are lasting effects from being Taken Out
 */
export interface PermanentInjury {
  id: string
  name: string
  description: string
  mechanicalEffect: string
  acquiredAt: number // Turn number
  circumstances: string // How it happened
}

/**
 * Common permanent injuries
 */
export const PERMANENT_INJURIES: Record<string, Omit<PermanentInjury, 'id' | 'acquiredAt' | 'circumstances'>> = {
  scarred: {
    name: 'Scarred',
    description: 'Permanent scars from grievous wounds',
    mechanicalEffect: 'Intimidating appearance, -1 to charm rolls but +1 to intimidate'
  },
  bad_leg: {
    name: 'Bad Leg',
    description: 'Permanent limp from severe injury',
    mechanicalEffect: '-1 to rolls involving running, jumping, or athletic movement'
  },
  one_eye: {
    name: 'Lost Eye',
    description: 'Lost an eye in combat',
    mechanicalEffect: '-1 to ranged attacks and perception rolls involving sight'
  },
  chronic_pain: {
    name: 'Chronic Pain',
    description: 'Lingering pain from untreated wounds',
    mechanicalEffect: 'Start each scene with 1 harm unless rested'
  },
  weak_lung: {
    name: 'Weak Lung',
    description: 'Breathing difficulties from chest trauma',
    mechanicalEffect: '-1 to endurance rolls, limited stamina'
  },
  shaky_hands: {
    name: 'Shaky Hands',
    description: 'Tremors from nerve damage',
    mechanicalEffect: '-1 to delicate tasks requiring steady hands'
  },
  ptsd: {
    name: 'PTSD',
    description: 'Psychological trauma from near-death experience',
    mechanicalEffect: 'When facing similar danger, roll to keep cool or freeze up'
  }
}

/**
 * Recovery Options
 * What can happen when a character is Taken Out
 */
export type RecoveryOutcome =
  | 'stabilized'           // Recovers with no lasting effects
  | 'permanent_injury'     // Recovers but gains a permanent injury
  | 'captured'             // Taken prisoner
  | 'heroic_sacrifice'     // Character chooses to die dramatically
  | 'dead'                 // Character dies

/**
 * Recovery Roll Result
 */
export interface RecoveryRollResult {
  outcome: RecoveryOutcome
  permanentInjury?: PermanentInjury
  message: string
  newHarm: HarmLevel
}

/**
 * Perform a recovery roll when Taken Out
 * This determines if a character survives and what consequences they face
 *
 * @param rollResult - Result of the recovery roll (typically 2d6 + modifiers)
 * @param circumstances - Description of how they were taken out
 * @param turnNumber - Current turn number
 * @returns Recovery outcome and any permanent injuries
 */
export function performRecoveryRoll(
  rollResult: number,
  circumstances: string,
  turnNumber: number
): RecoveryRollResult {
  // 10+: Stabilized with no lasting effects
  if (rollResult >= 10) {
    return {
      outcome: 'stabilized',
      message: 'You pull through remarkably well. Reduce harm to 4.',
      newHarm: 4
    }
  }

  // 7-9: Stabilized but with a permanent injury
  if (rollResult >= 7) {
    // Choose a random permanent injury
    const injuryKeys = Object.keys(PERMANENT_INJURIES)
    const randomKey = injuryKeys[Math.floor(Math.random() * injuryKeys.length)]
    const injuryTemplate = PERMANENT_INJURIES[randomKey as keyof typeof PERMANENT_INJURIES]

    const injury: PermanentInjury = {
      id: `${randomKey}_${Date.now()}`,
      ...injuryTemplate,
      acquiredAt: turnNumber,
      circumstances
    }

    return {
      outcome: 'permanent_injury',
      permanentInjury: injury,
      message: `You survive, but at a cost. You gain: ${injury.name}. Reduce harm to 5.`,
      newHarm: 5
    }
  }

  // 4-6: Captured or otherwise taken
  if (rollResult >= 4) {
    return {
      outcome: 'captured',
      message: 'You fall unconscious. What happens next is up to your enemies...',
      newHarm: 6
    }
  }

  // 1-3: Death's door - one more chance
  return {
    outcome: 'dead',
    message: 'You are dying. Someone must intervene immediately or you will die.',
    newHarm: 6
  }
}

/**
 * Heroic Sacrifice
 * A character chooses to die to achieve something important
 */
export interface HeroicSacrifice {
  characterId: string
  characterName: string
  turnNumber: number
  circumstances: string
  effect: string // What they accomplished
  legacy?: string // How they're remembered
}

/**
 * Perform a heroic sacrifice
 * This is a player choice, not a roll
 */
export function performHeroicSacrifice(
  characterId: string,
  characterName: string,
  circumstances: string,
  intendedEffect: string,
  turnNumber: number
): HeroicSacrifice {
  return {
    characterId,
    characterName,
    turnNumber,
    circumstances,
    effect: intendedEffect,
    legacy: `${characterName} gave their life ${circumstances}. Their sacrifice will not be forgotten.`
  }
}

/**
 * Apply medical attention
 * Reduces harm when someone tends to wounds
 */
export function applyMedicalAttention(
  currentHarm: HarmLevel,
  medicalSkill: 'basic' | 'trained' | 'expert',
  hasSupplies: boolean
): {
  newHarm: HarmLevel
  message: string
  success: boolean
} {
  // Can't heal someone at 0 harm
  if (currentHarm === 0) {
    return {
      newHarm: 0,
      message: 'No treatment needed - patient is healthy',
      success: true
    }
  }

  // Can't treat someone who is Taken Out without stabilizing first
  if (currentHarm === 6) {
    return {
      newHarm: 6,
      message: 'Patient must be stabilized before treatment can begin',
      success: false
    }
  }

  let healAmount = 0

  switch (medicalSkill) {
    case 'expert':
      healAmount = hasSupplies ? 3 : 2
      break
    case 'trained':
      healAmount = hasSupplies ? 2 : 1
      break
    case 'basic':
      healAmount = hasSupplies ? 1 : 0
      break
  }

  if (healAmount === 0) {
    return {
      newHarm: currentHarm,
      message: 'Treatment is ineffective without proper supplies',
      success: false
    }
  }

  const result = healHarm(currentHarm, healAmount)

  return {
    newHarm: result.newHarm,
    message: result.message,
    success: true
  }
}

/**
 * Rest and recover
 * Characters heal slowly over time with rest
 */
export function applyRest(
  currentHarm: HarmLevel,
  restQuality: 'poor' | 'adequate' | 'excellent'
): {
  newHarm: HarmLevel
  message: string
} {
  // Can't rest if Taken Out
  if (currentHarm === 6) {
    return {
      newHarm: 6,
      message: 'Cannot rest while Taken Out - stabilization required'
    }
  }

  let healAmount = 0

  switch (restQuality) {
    case 'excellent':
      healAmount = 2
      break
    case 'adequate':
      healAmount = 1
      break
    case 'poor':
      healAmount = 0
      break
  }

  if (healAmount === 0) {
    return {
      newHarm: currentHarm,
      message: 'Rest is insufficient to heal - conditions are too harsh'
    }
  }

  const result = healHarm(currentHarm, healAmount)

  return {
    newHarm: result.newHarm,
    message: `After resting, ${result.message.toLowerCase()}`
  }
}

/**
 * Check if a character is dying
 */
export function isDying(harm: HarmLevel, conditions: Condition[]): boolean {
  if (harm < 6) {
    return false
  }

  // Check if they have a "Stabilized" condition
  const hasStabilized = conditions.some(c =>
    c.name.toLowerCase().includes('stabilized') ||
    c.name.toLowerCase().includes('stable')
  )

  return !hasStabilized
}

/**
 * Stabilize a dying character
 * Emergency first aid to prevent death
 */
export function stabilizeCharacter(
  conditions: Condition[],
  turnNumber: number
): {
  updatedConditions: Condition[]
  message: string
} {
  const stabilizedCondition: Condition = {
    id: `stabilized_${Date.now()}`,
    name: 'Stabilized',
    category: 'Physical',
    description: 'No longer dying, but still critically injured',
    mechanicalEffect: 'Cannot act until harm reduced below 6',
    appliedAt: turnNumber
  }

  const result = markCondition(conditions, stabilizedCondition)

  return {
    updatedConditions: result.updatedConditions,
    message: 'Character is stabilized but still critically injured (harm 6)'
  }
}
