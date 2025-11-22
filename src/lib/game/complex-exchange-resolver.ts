// src/lib/game/complex-exchange-resolver.ts
// Phase 16.3-16.4: Complex Exchange Management & Narrative Action Flow
// Handles complex exchanges with multiple simultaneous actions

import { prisma } from '@/lib/prisma'
import { ExchangeManager, ActionPriority } from './exchange-manager'

/**
 * Micro-exchange structure for breaking down complex exchanges
 */
export interface MicroExchange {
  id: string
  priority: ActionPriority
  actions: any[]
  description: string
  sequenceOrder: number
}

/**
 * Action conflict detection
 */
export interface ActionConflict {
  type: 'contradictory' | 'simultaneous' | 'sequential'
  actions: any[]
  resolution: string
  needsGMIntervention: boolean
}

/**
 * Complex Exchange Resolver
 * Manages situations where >3 actions occur in a single exchange
 */
export class ComplexExchangeResolver {
  private campaignId: string
  private sceneId: string
  private exchangeManager: ExchangeManager

  constructor(campaignId: string, sceneId: string) {
    this.campaignId = campaignId
    this.sceneId = sceneId
    this.exchangeManager = new ExchangeManager(campaignId, sceneId)
  }

  /**
   * Break complex exchange into micro-exchanges by priority
   * Returns ordered sequence of micro-exchanges
   */
  async createMicroExchanges(): Promise<MicroExchange[]> {
    const actionsByPriority = await this.exchangeManager.getActionsByPriority()

    const microExchanges: MicroExchange[] = []
    let sequenceOrder = 0

    // 1. Immediate combat actions (highest priority)
    if (actionsByPriority[ActionPriority.IMMEDIATE_COMBAT].length > 0) {
      microExchanges.push({
        id: `combat-${Date.now()}`,
        priority: ActionPriority.IMMEDIATE_COMBAT,
        actions: actionsByPriority[ActionPriority.IMMEDIATE_COMBAT],
        description: 'Combat actions and immediate threats',
        sequenceOrder: sequenceOrder++
      })
    }

    // 2. Movement and positioning
    if (actionsByPriority[ActionPriority.MOVEMENT].length > 0) {
      microExchanges.push({
        id: `movement-${Date.now()}`,
        priority: ActionPriority.MOVEMENT,
        actions: actionsByPriority[ActionPriority.MOVEMENT],
        description: 'Movement and positioning changes',
        sequenceOrder: sequenceOrder++
      })
    }

    // 3. Social and investigation actions
    if (actionsByPriority[ActionPriority.SOCIAL].length > 0) {
      microExchanges.push({
        id: `social-${Date.now()}`,
        priority: ActionPriority.SOCIAL,
        actions: actionsByPriority[ActionPriority.SOCIAL],
        description: 'Social interactions and investigation',
        sequenceOrder: sequenceOrder++
      })
    }

    // 4. Other actions
    if (actionsByPriority[ActionPriority.OTHER].length > 0) {
      microExchanges.push({
        id: `other-${Date.now()}`,
        priority: ActionPriority.OTHER,
        actions: actionsByPriority[ActionPriority.OTHER],
        description: 'Miscellaneous actions',
        sequenceOrder: sequenceOrder++
      })
    }

    return microExchanges
  }

  /**
   * Detect conflicts between actions in the same micro-exchange
   */
  detectConflicts(microExchange: MicroExchange): ActionConflict[] {
    const conflicts: ActionConflict[] = []
    const actions = microExchange.actions

    if (actions.length < 2) {
      return conflicts
    }

    // Check for actions targeting the same NPC/entity
    const targetMap = new Map<string, any[]>()

    actions.forEach(action => {
      const targets = this.extractTargets(action.actionText)
      targets.forEach(target => {
        if (!targetMap.has(target)) {
          targetMap.set(target, [])
        }
        targetMap.get(target)!.push(action)
      })
    })

    // Detect conflicting actions on same target
    targetMap.forEach((targetActions, target) => {
      if (targetActions.length > 1) {
        const types = targetActions.map(a => this.classifyActionIntent(a.actionText))

        // Check for contradictory actions (e.g., attack vs negotiate)
        const hasAttack = types.some(t => t === 'attack')
        const hasNegotiate = types.some(t => t === 'negotiate')

        if (hasAttack && hasNegotiate) {
          conflicts.push({
            type: 'contradictory',
            actions: targetActions,
            resolution: `Some characters are trying to attack ${target} while others negotiate. AI will prioritize by timing and fiction.`,
            needsGMIntervention: true
          })
        } else if (types.every(t => t === 'attack')) {
          conflicts.push({
            type: 'simultaneous',
            actions: targetActions,
            resolution: `Multiple characters attacking ${target} simultaneously. Combined effect will be narrated.`,
            needsGMIntervention: false
          })
        }
      }
    })

    return conflicts
  }

  /**
   * Generate coherent narrative sequence from complex exchange
   * This provides context to the AI GM for proper resolution
   */
  async generateNarrativeSequence(microExchanges: MicroExchange[]): Promise<string> {
    let narrative = '## Complex Exchange Breakdown\n\n'

    narrative += `This exchange contains ${microExchanges.length} phases of action:\n\n`

    for (const micro of microExchanges) {
      narrative += `### Phase ${micro.sequenceOrder + 1}: ${micro.description}\n\n`

      for (const action of micro.actions) {
        narrative += `- **${action.character?.name || 'Unknown'}**: ${action.actionText}\n`
      }

      // Add detected conflicts
      const conflicts = this.detectConflicts(micro)
      if (conflicts.length > 0) {
        narrative += `\n**⚠️ Conflicts Detected:**\n`
        conflicts.forEach(conflict => {
          narrative += `- ${conflict.resolution}\n`
        })
      }

      narrative += '\n'
    }

    narrative += '---\n\n'
    narrative += '**AI GM Instructions:**\n'
    narrative += '1. Resolve each phase in sequence order\n'
    narrative += '2. Earlier phases may affect outcomes of later phases\n'
    narrative += '3. Use fictional timing to determine exact order within each phase\n'
    narrative += '4. Narrate a coherent, flowing sequence that honors player intent\n'
    narrative += '5. If conflicts exist, resolve them based on the fiction and PbtA principles\n\n'

    return narrative
  }

  /**
   * Extract targets from action text (simple heuristic)
   */
  private extractTargets(actionText: string): string[] {
    const targets: string[] = []
    const lower = actionText.toLowerCase()

    // Common target patterns
    const patterns = [
      /(?:attack|strike|hit|shoot)\s+(?:the\s+)?(\w+)/gi,
      /(?:talk to|speak with|negotiate with|convince)\s+(?:the\s+)?(\w+)/gi,
      /(?:target|at)\s+(?:the\s+)?(\w+)/gi
    ]

    patterns.forEach(pattern => {
      const matches = actionText.matchAll(pattern)
      for (const match of matches) {
        if (match[1]) {
          targets.push(match[1].toLowerCase())
        }
      }
    })

    return [...new Set(targets)] // Remove duplicates
  }

  /**
   * Classify action intent
   */
  private classifyActionIntent(actionText: string): string {
    const lower = actionText.toLowerCase()

    if (lower.includes('attack') || lower.includes('strike') || lower.includes('shoot') || lower.includes('fight')) {
      return 'attack'
    }

    if (lower.includes('negotiate') || lower.includes('persuade') || lower.includes('convince') || lower.includes('talk')) {
      return 'negotiate'
    }

    if (lower.includes('defend') || lower.includes('protect') || lower.includes('guard')) {
      return 'defend'
    }

    if (lower.includes('investigate') || lower.includes('search') || lower.includes('examine')) {
      return 'investigate'
    }

    return 'other'
  }

  /**
   * Resolve complex exchange with micro-exchange breakdown
   * Returns structured data for AI GM processing
   */
  async resolveComplexExchange(): Promise<{
    microExchanges: MicroExchange[]
    narrativeSequence: string
    conflicts: ActionConflict[]
    totalActions: number
  }> {
    const microExchanges = await this.createMicroExchanges()
    const narrativeSequence = await this.generateNarrativeSequence(microExchanges)

    // Collect all conflicts
    const allConflicts: ActionConflict[] = []
    microExchanges.forEach(micro => {
      const conflicts = this.detectConflicts(micro)
      allConflicts.push(...conflicts)
    })

    const totalActions = microExchanges.reduce((sum, micro) => sum + micro.actions.length, 0)

    return {
      microExchanges,
      narrativeSequence,
      conflicts: allConflicts,
      totalActions
    }
  }
}

/**
 * Narrative Action Flow Manager
 * Helps AI GM determine fictional timing and consequences
 */
export class NarrativeFlowManager {
  /**
   * Generate AI GM prompt additions for narrative action flow
   */
  static generateFlowGuidance(actions: any[]): string {
    let guidance = '## Narrative Action Flow Guidance\n\n'

    guidance += '**Fiction First Principle:**\n'
    guidance += 'Actions do not happen in strict turn order. They flow based on the fiction and narrative timing.\n\n'

    guidance += '**One Meaningful Action Per Exchange:**\n'
    guidance += 'Each player gets one significant action per exchange. Multiple players can act in the same fictional "moment".\n\n'

    guidance += '**Framing Threats:**\n'
    guidance += 'When a threat emerges, frame it clearly: "The orc swings at you, Marcus, what do you do?"\n'
    guidance += 'Players respond with their actions, which may trigger moves and rolls.\n\n'

    guidance += '**Respect System Rolls:**\n'
    guidance += 'If a roll was made, treat it as absolute truth:\n'
    guidance += '- Strong Hit (10+): Player gets what they want with minimal cost\n'
    guidance += '- Weak Hit (7-9): Player gets what they want, but with a cost, complication, or hard choice\n'
    guidance += '- Miss (6-): Things go wrong, GM makes a hard move\n\n'

    guidance += '**Simultaneous Actions:**\n'
    guidance += 'When multiple players act against the same threat, weave their actions together into a coherent narrative.\n'
    guidance += 'The combined effect should be greater than individual actions alone.\n\n'

    return guidance
  }

  /**
   * Detect if exchange needs special handling (e.g., PvP conflict)
   */
  static detectSpecialCases(actions: any[]): {
    hasPvP: boolean
    hasEnvironmentalActions: boolean
    hasCompetingGoals: boolean
  } {
    // Simple heuristic - in real implementation, this would be more sophisticated
    const actionTexts = actions.map(a => a.actionText.toLowerCase())

    const hasPvP = actionTexts.some(text =>
      text.includes('another player') || text.includes('other character')
    )

    const hasEnvironmentalActions = actionTexts.some(text =>
      text.includes('environment') || text.includes('room') || text.includes('door')
    )

    const hasCompetingGoals = actions.length > 2 &&
      actions.some(a => this.getActionGoal(a) !== this.getActionGoal(actions[0]))

    return {
      hasPvP,
      hasEnvironmentalActions,
      hasCompetingGoals
    }
  }

  private static getActionGoal(action: any): string {
    const text = action.actionText.toLowerCase()
    if (text.includes('escape') || text.includes('flee')) return 'escape'
    if (text.includes('fight') || text.includes('attack')) return 'combat'
    if (text.includes('negotiate') || text.includes('talk')) return 'social'
    return 'other'
  }
}
