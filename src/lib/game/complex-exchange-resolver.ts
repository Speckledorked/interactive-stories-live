// src/lib/game/complex-exchange-resolver.ts
// Phase 16.3-16.4: Complex Exchange Management & Narrative Action Flow
// Handles complex exchanges with multiple simultaneous actions

import { prisma } from '@/lib/prisma'
import { ExchangeManager, ActionPriority } from './exchange-manager'
import type { ActionMechanics } from './resolution'
import { normalizeEntityName } from './entityResolution'

/**
 * A campaign entity (Character or NPC) conflict detection can resolve an
 * action's target against. Callers pass the scene's actual roster (see
 * sceneResolutionRequest.ts) — never a hardcoded or guessed list.
 */
export interface ExchangeRosterEntity {
  id: string
  name: string
}

// Filler words stripped from an entity's own name before matching, so a
// name like "Lord of the North" only requires "lord"/"north" to appear, not
// the connective words. actionText itself is never stripped — the exact
// words of a roster entity's name still have to appear in it, just not
// contiguously or in the entity's own order (see extractTargets below).
const TARGET_NAME_STOPWORDS = new Set(['the', 'a', 'an', 'of', 'to', 'in', 'on', 'at', 'and'])

function significantNameWords(name: string): string[] {
  return normalizeEntityName(name)
    .split(' ')
    .filter((w) => w.length > 0 && !TARGET_NAME_STOPWORDS.has(w))
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function containsWholeWord(text: string, word: string): boolean {
  return new RegExp(`\\b${escapeRegExp(word)}\\b`, 'i').test(text)
}

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
  // Deterministic precedence — see rankActionsByOutcome below. Character
  // names in the order their actions actually take effect. Always present;
  // a single-action "conflict" (shouldn't occur, but defensively) is just
  // that one name.
  resolutionOrder: string[]
}

/** The subset of a computed roll actually needed to rank precedence. */
type MechanicsForRanking = Pick<ActionMechanics, 'outcome' | 'total'>

const OUTCOME_RANK: Record<ActionMechanics['outcome'], number> = { strongHit: 2, weakHit: 1, miss: 0 }

/**
 * Deterministic precedence between two actions competing for the same
 * target: the dice already decided how well each one went (see
 * lib/game/resolution.ts) — a strong hit takes effect before a weak hit,
 * which takes effect before a miss, with the numeric total breaking ties
 * within the same band. An action nobody rolled for (no_roll, or a
 * classification/roll failure) sorts after every rolled action — real
 * mechanical success in the fiction outranks an unrolled attempt, not the
 * other way around. Returns negative if `a` precedes `b`, matching
 * Array.prototype.sort's contract; stable-sorts to original array order
 * (already priority-bucketed) as the final, deterministic tiebreak — never
 * "the AI decides by fictional timing."
 */
export function compareActionsByOutcome(
  a: { id: string },
  b: { id: string },
  mechanicsByActionId: Map<string, MechanicsForRanking>
): number {
  const ma = mechanicsByActionId.get(a.id)
  const mb = mechanicsByActionId.get(b.id)
  if (!ma && !mb) return 0
  if (!ma) return 1
  if (!mb) return -1
  const rankDiff = OUTCOME_RANK[mb.outcome] - OUTCOME_RANK[ma.outcome]
  if (rankDiff !== 0) return rankDiff
  return mb.total - ma.total
}

/**
 * Rank a set of competing actions into their deterministic resolution
 * order. Pure given the mechanics lookup — no DB access, unit-testable
 * directly.
 */
export function rankActionsByOutcome(
  actions: Array<{ id: string; character?: { name?: string } }>,
  mechanicsByActionId: Map<string, MechanicsForRanking>
): Array<{ id: string; character?: { name?: string } }> {
  return [...actions].sort((a, b) => compareActionsByOutcome(a, b, mechanicsByActionId))
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
   * Detect conflicts between actions in the same micro-exchange, and
   * deterministically resolve their precedence via rankActionsByOutcome
   * when roll mechanics are available (see resolution.ts) — the dice
   * already decided how well each action went; this decides which one's
   * effect on a shared target actually lands first, rather than leaving
   * that entirely to the AI's judgment.
   */
  detectConflicts(
    microExchange: MicroExchange,
    mechanicsByActionId: Map<string, MechanicsForRanking> = new Map(),
    roster: ExchangeRosterEntity[] = []
  ): ActionConflict[] {
    const conflicts: ActionConflict[] = []
    const actions = microExchange.actions

    if (actions.length < 2) {
      return conflicts
    }

    // Check for actions targeting the same roster entity (Character or NPC)
    const targetMap = new Map<string, { entity: ExchangeRosterEntity; actions: any[] }>()

    actions.forEach(action => {
      const targets = this.extractTargets(action.actionText, roster)
      targets.forEach(entity => {
        if (!targetMap.has(entity.id)) {
          targetMap.set(entity.id, { entity, actions: [] })
        }
        targetMap.get(entity.id)!.actions.push(action)
      })
    })

    // Detect conflicting actions on same target
    targetMap.forEach(({ entity, actions: targetActions }) => {
      if (targetActions.length > 1) {
        const target = entity.name
        const types = targetActions.map(a => this.classifyActionIntent(a.actionText))
        const ranked = rankActionsByOutcome(targetActions, mechanicsByActionId)
        const resolutionOrder = ranked.map(a => a.character?.name || 'Unknown')

        // Check for contradictory actions (e.g., attack vs negotiate)
        const hasAttack = types.some(t => t === 'attack')
        const hasNegotiate = types.some(t => t === 'negotiate')

        if (hasAttack && hasNegotiate) {
          const winner = ranked[0]
          const winnerMechanics = mechanicsByActionId.get(winner.id)
          const winnerName = winner.character?.name || 'Unknown'
          const others = resolutionOrder.slice(1).join(', ')
          conflicts.push({
            type: 'contradictory',
            actions: targetActions,
            resolution: winnerMechanics
              ? `${winnerName}'s action against ${target} takes precedence (${winnerMechanics.outcome}, roll total ${winnerMechanics.total}) — narrate ${others}'s attempt as overtaken by it.`
              : `${winnerName}'s action against ${target} takes precedence (no roll on record for the others) — narrate ${others}'s attempt as overtaken by it.`,
            needsGMIntervention: true,
            resolutionOrder,
          })
        } else if (types.every(t => t === 'attack')) {
          conflicts.push({
            type: 'simultaneous',
            actions: targetActions,
            resolution: `Multiple characters attacking ${target} simultaneously — resolved in order of decisive effect (${resolutionOrder.join(' -> ')}); narrate their combined effect as landing together.`,
            needsGMIntervention: false,
            resolutionOrder,
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
  async generateNarrativeSequence(
    microExchanges: MicroExchange[],
    mechanicsByActionId: Map<string, MechanicsForRanking> = new Map(),
    roster: ExchangeRosterEntity[] = []
  ): Promise<string> {
    let narrative = '## Complex Exchange Breakdown\n\n'

    narrative += `This exchange contains ${microExchanges.length} phases of action:\n\n`

    for (const micro of microExchanges) {
      narrative += `### Phase ${micro.sequenceOrder + 1}: ${micro.description}\n\n`

      for (const action of micro.actions) {
        narrative += `- **${action.character?.name || 'Unknown'}**: ${action.actionText}\n`
      }

      // Add detected conflicts
      const conflicts = this.detectConflicts(micro, mechanicsByActionId, roster)
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
    narrative += '3. Within a phase, follow the resolution order already determined above (by roll outcome, not guesswork)\n'
    narrative += '4. Narrate a coherent, flowing sequence that honors player intent\n'
    narrative += '5. Conflicts above are already resolved mechanically — narrate the stated outcome, don\'t re-decide who prevails\n\n'

    return narrative
  }

  /**
   * Resolve which of the scene's real roster entities (Character or NPC)
   * an action's free text refers to, per #294: an entity matches when every
   * significant word of its own name (stopwords like "the"/"of" stripped)
   * appears as a whole word somewhere in the action text, in any order —
   * not a single-word regex extraction keyed to a fixed verb list. This is
   * what makes "attack the captain of the guard" and "negotiate with the
   * guard captain" resolve to the same entity (both contain "guard" and
   * "captain") despite sharing no contiguous substring, where the old
   * regex extracted a different single word from each. Grouping downstream
   * is by resolved entity id, never by raw extracted text.
   */
  private extractTargets(actionText: string, roster: ExchangeRosterEntity[]): ExchangeRosterEntity[] {
    return roster.filter((entity) => {
      const words = significantNameWords(entity.name)
      return words.length > 0 && words.every((w) => containsWholeWord(actionText, w))
    })
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
   *
   * @param mechanicsByActionId - already-computed roll mechanics for this
   *   exchange's actions (see resolveActionMechanics in resolution.ts) —
   *   when provided, conflicting actions on the same target are ranked by
   *   actual roll outcome (see rankActionsByOutcome) instead of being left
   *   for the AI to arbitrate freeform.
   * @param roster - the scene's actual Character/NPC roster, used to
   *   resolve which real entity an action's free text refers to (#294).
   *   Conflict detection finds nothing without it — an empty/omitted
   *   roster means no targets can ever resolve, not a silent fallback to
   *   the old regex heuristic.
   */
  async resolveComplexExchange(
    mechanicsByActionId: Map<string, MechanicsForRanking> = new Map(),
    roster: ExchangeRosterEntity[] = []
  ): Promise<{
    microExchanges: MicroExchange[]
    narrativeSequence: string
    conflicts: ActionConflict[]
    totalActions: number
  }> {
    const microExchanges = await this.createMicroExchanges()
    const narrativeSequence = await this.generateNarrativeSequence(microExchanges, mechanicsByActionId, roster)

    // Collect all conflicts
    const allConflicts: ActionConflict[] = []
    microExchanges.forEach(micro => {
      const conflicts = this.detectConflicts(micro, mechanicsByActionId, roster)
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
