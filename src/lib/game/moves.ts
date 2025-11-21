// src/lib/game/moves.ts
// Move registry system for PbtA-style character moves
// Moves are actions with special mechanical effects

/**
 * Move Definition
 * A move is a special action a character can take
 */
export interface Move {
  id: string
  name: string
  description: string
  tags: string[] // e.g., ["combat", "social", "investigation"]

  // Trigger
  trigger: string // When can this move be used? e.g., "When you attack in close combat..."

  // Prerequisites
  prerequisites?: {
    minStat?: { [statKey: string]: number } // e.g., { cool: 1 }
    requiredPerks?: string[] // Must have these perks
    excludedPerks?: string[] // Cannot have these perks
    minLevel?: number // Minimum XP level
  }

  // Mechanical effects
  effects: {
    type: 'roll' | 'automatic' | 'choice'
    rollFormula?: string // e.g., "2d6+cool"

    // Outcomes for rolls
    outcomes?: {
      hit10?: string // 10+ result
      hit7?: string  // 7-9 result
      miss?: string  // 6- result
    }

    // Automatic effects
    automaticEffect?: string

    // Choice effects
    choices?: Array<{
      description: string
      effect: string
    }>
  }

  // Cost to use
  cost?: {
    harm?: number
    hold?: number
    resource?: string
  }
}

/**
 * Move Registry
 * Collection of all moves available in a campaign
 */
export interface MoveRegistry {
  campaignId: string
  moves: Move[]
  categories: {
    [category: string]: string[] // category name -> move IDs
  }
}

/**
 * Basic Moves
 * Core PbtA-inspired moves available to all characters
 */
export const BASIC_MOVES: Move[] = [
  {
    id: 'act_under_fire',
    name: 'Act Under Fire',
    description: 'When you do something under pressure or in danger',
    tags: ['basic', 'general'],
    trigger: 'When you act under fire or pressure',
    effects: {
      type: 'roll',
      rollFormula: '2d6+cool',
      outcomes: {
        hit10: 'You do it without hesitation',
        hit7: 'You do it, but there\'s a cost, complication, or hard choice',
        miss: 'Things go badly - the GM makes a hard move'
      }
    }
  },
  {
    id: 'go_aggro',
    name: 'Go Aggro',
    description: 'When you threaten or attack someone',
    tags: ['basic', 'combat', 'social'],
    trigger: 'When you threaten or use force to make someone do what you want',
    effects: {
      type: 'roll',
      rollFormula: '2d6+hard',
      outcomes: {
        hit10: 'They do what you want',
        hit7: 'They do it, but they choose: cave immediately, fight back, or give you something better',
        miss: 'They fight back or flee, and it goes badly for you'
      }
    }
  },
  {
    id: 'seize_by_force',
    name: 'Seize By Force',
    description: 'When you fight to take something by force',
    tags: ['basic', 'combat'],
    trigger: 'When you fight to seize or hold something',
    effects: {
      type: 'roll',
      rollFormula: '2d6+hard',
      outcomes: {
        hit10: 'Choose 3 from: you take definite hold, you inflict harm, you impress/frighten/dismay them, you suffer little harm',
        hit7: 'Choose 2 from the above list',
        miss: 'You fail to seize it, or you pay a terrible price'
      }
    }
  },
  {
    id: 'read_a_situation',
    name: 'Read a Situation',
    description: 'When you assess a charged situation',
    tags: ['basic', 'investigation'],
    trigger: 'When you read a charged or tense situation',
    effects: {
      type: 'roll',
      rollFormula: '2d6+sharp',
      outcomes: {
        hit10: 'Ask 3 questions from the list',
        hit7: 'Ask 1 question from the list',
        miss: 'Ask 1 anyway, but you reveal something or someone notices you'
      }
    }
  },
  {
    id: 'read_a_person',
    name: 'Read a Person',
    description: 'When you read someone\'s intentions or emotions',
    tags: ['basic', 'social', 'investigation'],
    trigger: 'When you closely study someone in a charged interaction',
    effects: {
      type: 'roll',
      rollFormula: '2d6+sharp',
      outcomes: {
        hit10: 'Ask 3: Are they telling the truth? What do they want? How can I get them to ___? What are they really feeling?',
        hit7: 'Ask 1 question from the list',
        miss: 'You misread them or they notice your scrutiny'
      }
    }
  },
  {
    id: 'help_or_interfere',
    name: 'Help or Interfere',
    description: 'When you help or hinder someone',
    tags: ['basic', 'social'],
    trigger: 'When you help or interfere with someone who\'s making a roll',
    effects: {
      type: 'roll',
      rollFormula: '2d6+bond',
      outcomes: {
        hit10: 'They take +1 or -2 to their roll (your choice if helping/hindering)',
        hit7: 'They take +1 or -2, but you expose yourself to danger or cost',
        miss: 'Your help backfires or they blame you'
      }
    }
  }
]

/**
 * Advanced Moves
 * Specialized moves characters can unlock through play
 */
export const ADVANCED_MOVES: Move[] = [
  {
    id: 'deadly_precision',
    name: 'Deadly Precision',
    description: 'When you attack with precision rather than force',
    tags: ['combat', 'advanced'],
    trigger: 'When you make a careful, precise attack',
    prerequisites: {
      minStat: { cool: 1 },
      minLevel: 3
    },
    effects: {
      type: 'roll',
      rollFormula: '2d6+cool',
      outcomes: {
        hit10: 'Deal +2 harm and choose 1: avoid their counterattack, impress observers, disable rather than kill',
        hit7: 'Deal +1 harm',
        miss: 'You telegraph your move and they react'
      }
    }
  },
  {
    id: 'silver_tongue',
    name: 'Silver Tongue',
    description: 'You\'re extremely persuasive',
    tags: ['social', 'advanced'],
    trigger: 'When you try to manipulate or convince someone',
    prerequisites: {
      minStat: { hot: 2 }
    },
    effects: {
      type: 'roll',
      rollFormula: '2d6+hot',
      outcomes: {
        hit10: 'They do what you want, and you can ask a follow-up favor',
        hit7: 'They do it, but only if you promise something in return',
        miss: 'They refuse and grow suspicious of you'
      }
    }
  },
  {
    id: 'tactical_genius',
    name: 'Tactical Genius',
    description: 'You can analyze and exploit tactical situations',
    tags: ['combat', 'investigation', 'advanced'],
    trigger: 'When you analyze a tactical situation',
    prerequisites: {
      minStat: { sharp: 2 },
      minLevel: 5
    },
    effects: {
      type: 'roll',
      rollFormula: '2d6+sharp',
      outcomes: {
        hit10: 'Name an advantage you can exploit. Everyone acting on your plan gets +1 forward',
        hit7: 'Name an advantage, but exploiting it will cost something',
        miss: 'You see a trap or disadvantage the enemy has prepared'
      }
    }
  }
]

/**
 * Check if a character meets the prerequisites for a move
 */
export function canUseMove(
  move: Move,
  characterStats: Record<string, number>,
  characterPerks: Array<{ id: string }>,
  characterLevel: number = 0
): {
  canUse: boolean
  reason?: string
} {
  if (!move.prerequisites) {
    return { canUse: true }
  }

  const prereqs = move.prerequisites

  // Check stat requirements
  if (prereqs.minStat) {
    for (const [statKey, minValue] of Object.entries(prereqs.minStat)) {
      const characterValue = characterStats[statKey] || 0
      if (characterValue < minValue) {
        return {
          canUse: false,
          reason: `Requires ${statKey} >= ${minValue} (you have ${characterValue})`
        }
      }
    }
  }

  // Check required perks
  if (prereqs.requiredPerks && prereqs.requiredPerks.length > 0) {
    const characterPerkIds = characterPerks.map(p => p.id)
    for (const requiredPerk of prereqs.requiredPerks) {
      if (!characterPerkIds.includes(requiredPerk)) {
        return {
          canUse: false,
          reason: `Requires perk: ${requiredPerk}`
        }
      }
    }
  }

  // Check excluded perks
  if (prereqs.excludedPerks && prereqs.excludedPerks.length > 0) {
    const characterPerkIds = characterPerks.map(p => p.id)
    for (const excludedPerk of prereqs.excludedPerks) {
      if (characterPerkIds.includes(excludedPerk)) {
        return {
          canUse: false,
          reason: `Cannot have perk: ${excludedPerk}`
        }
      }
    }
  }

  // Check level requirement
  if (prereqs.minLevel !== undefined && characterLevel < prereqs.minLevel) {
    return {
      canUse: false,
      reason: `Requires level ${prereqs.minLevel} (you are level ${characterLevel})`
    }
  }

  return { canUse: true }
}

/**
 * Get all moves a character can use
 */
export function getAvailableMoves(
  allMoves: Move[],
  characterStats: Record<string, number>,
  characterPerks: Array<{ id: string }>,
  characterLevel: number = 0,
  characterMoveIds: string[] = []
): Move[] {
  return allMoves.filter(move => {
    // Character must have unlocked the move
    if (characterMoveIds.length > 0 && !characterMoveIds.includes(move.id)) {
      // Basic moves are always available
      if (!move.tags.includes('basic')) {
        return false
      }
    }

    // Check if they can use it
    const check = canUseMove(move, characterStats, characterPerks, characterLevel)
    return check.canUse
  })
}

/**
 * Create a default move registry for a campaign
 */
export function createDefaultMoveRegistry(campaignId: string): MoveRegistry {
  return {
    campaignId,
    moves: [...BASIC_MOVES, ...ADVANCED_MOVES],
    categories: {
      basic: BASIC_MOVES.map(m => m.id),
      combat: ['seize_by_force', 'go_aggro', 'deadly_precision', 'tactical_genius'],
      social: ['go_aggro', 'read_a_person', 'help_or_interfere', 'silver_tongue'],
      investigation: ['read_a_situation', 'read_a_person', 'tactical_genius'],
      advanced: ADVANCED_MOVES.map(m => m.id)
    }
  }
}

/**
 * Add a custom move to the registry
 */
export function addMoveToRegistry(
  registry: MoveRegistry,
  move: Move,
  category?: string
): MoveRegistry {
  // Check if move already exists
  const existingIndex = registry.moves.findIndex(m => m.id === move.id)

  let updatedMoves: Move[]
  if (existingIndex >= 0) {
    // Replace existing move
    updatedMoves = [...registry.moves]
    updatedMoves[existingIndex] = move
  } else {
    // Add new move
    updatedMoves = [...registry.moves, move]
  }

  // Update categories
  const updatedCategories = { ...registry.categories }
  if (category) {
    if (!updatedCategories[category]) {
      updatedCategories[category] = []
    }
    if (!updatedCategories[category].includes(move.id)) {
      updatedCategories[category] = [...updatedCategories[category], move.id]
    }
  }

  return {
    ...registry,
    moves: updatedMoves,
    categories: updatedCategories
  }
}

/**
 * Get a move by ID
 */
export function getMoveById(registry: MoveRegistry, moveId: string): Move | undefined {
  return registry.moves.find(m => m.id === moveId)
}

/**
 * Get moves by category
 */
export function getMovesByCategory(registry: MoveRegistry, category: string): Move[] {
  const moveIds = registry.categories[category] || []
  return moveIds
    .map(id => registry.moves.find(m => m.id === id))
    .filter((m): m is Move => m !== undefined)
}

/**
 * Get moves by tags
 */
export function getMovesByTags(registry: MoveRegistry, tags: string[]): Move[] {
  return registry.moves.filter(move =>
    tags.some(tag => move.tags.includes(tag))
  )
}

/**
 * Format move for display
 */
export function formatMove(move: Move): string {
  let formatted = `**${move.name}**\n`
  formatted += `${move.description}\n\n`
  formatted += `*${move.trigger}*\n\n`

  if (move.effects.type === 'roll' && move.effects.outcomes) {
    formatted += `Roll ${move.effects.rollFormula}:\n`
    if (move.effects.outcomes.hit10) {
      formatted += `• 10+: ${move.effects.outcomes.hit10}\n`
    }
    if (move.effects.outcomes.hit7) {
      formatted += `• 7-9: ${move.effects.outcomes.hit7}\n`
    }
    if (move.effects.outcomes.miss) {
      formatted += `• 6-: ${move.effects.outcomes.miss}\n`
    }
  } else if (move.effects.automaticEffect) {
    formatted += `Effect: ${move.effects.automaticEffect}\n`
  }

  if (move.cost) {
    formatted += `\nCost: `
    const costs = []
    if (move.cost.harm) costs.push(`${move.cost.harm} harm`)
    if (move.cost.hold) costs.push(`${move.cost.hold} hold`)
    if (move.cost.resource) costs.push(move.cost.resource)
    formatted += costs.join(', ')
  }

  return formatted
}

/**
 * Validate move structure
 */
export function validateMove(move: any): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!move.id || typeof move.id !== 'string') {
    errors.push('Move must have a valid id')
  }

  if (!move.name || typeof move.name !== 'string') {
    errors.push('Move must have a valid name')
  }

  if (!move.description || typeof move.description !== 'string') {
    errors.push('Move must have a valid description')
  }

  if (!move.trigger || typeof move.trigger !== 'string') {
    errors.push('Move must have a valid trigger')
  }

  if (!Array.isArray(move.tags)) {
    errors.push('Move must have tags array')
  }

  if (!move.effects || typeof move.effects !== 'object') {
    errors.push('Move must have effects object')
  } else {
    if (!['roll', 'automatic', 'choice'].includes(move.effects.type)) {
      errors.push('Move effects type must be roll, automatic, or choice')
    }
  }

  return {
    valid: errors.length === 0,
    errors
  }
}
