// src/lib/game/exchange-manager.ts
// Phase 16: Exchange-Based Action System for PbtA-style freeform combat
// Manages action exchanges without strict turn order

import { prisma } from '@/lib/prisma'

/**
 * Exchange State Structure
 */
export interface ExchangeState {
  playersActed: string[] // Character IDs who have acted
  exchangeNumber: number
  isComplete: boolean
  complexity: 'simple' | 'complex'
  actionsThisExchange: number
  timestamp: Date
}

/**
 * Zone Position (Phase 16.6)
 */
export type ZonePosition = 'close' | 'near' | 'far' | 'distant'

export interface ZoneMetadata {
  customZones?: string[]
  zoneEffects?: Record<string, any>
}

/**
 * Action Priority for complex exchanges
 */
export enum ActionPriority {
  IMMEDIATE_COMBAT = 1,    // Attacks, defenses
  MOVEMENT = 2,             // Positioning changes
  SOCIAL = 3,               // Negotiation, investigation
  OTHER = 4                 // Everything else
}

/**
 * Exchange Manager
 * Handles the freeform exchange-based action system
 */
export class ExchangeManager {
  private campaignId: string
  private sceneId: string

  constructor(campaignId: string, sceneId: string) {
    this.campaignId = campaignId
    this.sceneId = sceneId
  }

  /**
   * Initialize a new exchange for a scene
   */
  async initializeExchange(): Promise<ExchangeState> {
    const scene = await prisma.scene.findUnique({
      where: { id: this.sceneId },
      include: {
        playerActions: {
          where: { status: 'pending' }
        }
      }
    })

    if (!scene) {
      throw new Error('Scene not found')
    }

    const currentExchangeNumber = (scene.currentExchange || 0) + 1

    const exchangeState: ExchangeState = {
      playersActed: [],
      exchangeNumber: currentExchangeNumber,
      isComplete: false,
      complexity: 'simple',
      actionsThisExchange: 0,
      timestamp: new Date()
    }

    await prisma.scene.update({
      where: { id: this.sceneId },
      data: {
        currentExchange: currentExchangeNumber,
        exchangeState: exchangeState as any
      }
    })

    return exchangeState
  }

  /**
   * Record a player action in the current exchange
   */
  async recordAction(characterId: string, actionId: string): Promise<ExchangeState> {
    const scene = await prisma.scene.findUnique({
      where: { id: this.sceneId }
    })

    if (!scene) {
      throw new Error('Scene not found')
    }

    // currentExchange is a non-nullable Int (@default(0)) — `|| 1` here
    // used to treat a real, legitimate 0 (a scene's first-ever exchange)
    // as falsy and jump to 1, diverging this action's exchangeNumber
    // from the scene's actual currentExchange counter (which
    // completeExchange/initializeExchange read directly, uncoerced).
    // That left the action stuck 'pending' forever — completeExchange's
    // cleanup filter never matched it — which looked to the player
    // like the game refusing new actions after a resolution. `?? 0`
    // preserves a real 0.
    const exchangeNumber = scene.currentExchange ?? 0

    // Stamped once, up front — this doesn't change across the retries
    // below (only the shared exchangeState blob is contended).
    await prisma.playerAction.update({
      where: { id: actionId },
      data: { exchangeNumber }
    })

    // Merge this character into the scene's shared exchangeState.
    // Two players acting within the same instant would otherwise hit a
    // classic lost update here: both read the same exchangeState, both
    // append their own characterId to their own in-memory copy, and
    // whichever write lands second silently overwrites the first —
    // dropping that player's action from playersActed even though their
    // PlayerAction row is still genuinely pending. Guarding the write on
    // `updatedAt` (optimistic concurrency) makes a losing write retry
    // against the now-current state instead of clobbering it.
    const MAX_ATTEMPTS = 5
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const liveScene = attempt === 0 ? scene : await prisma.scene.findUnique({ where: { id: this.sceneId } })
      if (!liveScene) {
        throw new Error('Scene not found')
      }

      const currentState = (liveScene.exchangeState as any as ExchangeState) || {
        playersActed: [],
        exchangeNumber,
        isComplete: false,
        complexity: 'simple',
        actionsThisExchange: 0,
        timestamp: new Date()
      }

      if (!currentState.playersActed.includes(characterId)) {
        currentState.playersActed.push(characterId)
      }

      currentState.actionsThisExchange++

      if (currentState.actionsThisExchange > 3) {
        currentState.complexity = 'complex'
      }

      const result = await prisma.scene.updateMany({
        where: { id: this.sceneId, updatedAt: liveScene.updatedAt },
        data: { exchangeState: currentState as any }
      })

      if (result.count > 0) {
        return currentState
      }
      // Lost the race — someone else updated the scene since liveScene
      // was read. Retry against the fresh row.
    }

    throw new Error('Failed to record action: too much contention on scene exchange state')
  }

  /**
   * Check if an exchange is ready to be resolved
   * Returns true if all active players have acted OR GM forces resolution
   */
  async canResolveExchange(forceResolve: boolean = false): Promise<boolean> {
    if (forceResolve) {
      return true
    }

    // First fetch scene to get currentExchange
    const sceneData = await prisma.scene.findUnique({
      where: { id: this.sceneId },
      select: {
        currentExchange: true,
      }
    })

    if (!sceneData) {
      return false
    }

    // Then fetch full scene with filtered playerActions
    const scene = await prisma.scene.findUnique({
      where: { id: this.sceneId },
      include: {
        campaign: {
          include: {
            characters: {
              where: {
                isAlive: true
              }
            }
          }
        },
        playerActions: {
          where: {
            status: 'pending',
            exchangeNumber: sceneData.currentExchange || 0
          }
        }
      }
    })

    if (!scene) {
      return false
    }

    const currentState = scene.exchangeState as any as ExchangeState

    if (!currentState) {
      return true // No exchange state, can resolve
    }

    // Get active characters in this scene
    const participants = scene.participants as any
    const activeCharacterIds = participants?.characterIds || []

    // Check if all active characters have acted
    const allActed = activeCharacterIds.every((charId: string) =>
      currentState.playersActed.includes(charId)
    )

    // `|| currentState.actionsThisExchange > 0` used to live here, which
    // made this true as soon as a SINGLE participant acted (any recorded
    // action makes actionsThisExchange > 0) — directly contradicting this
    // function's own contract ("all active players have acted"). That let
    // a scene auto-resolve off just one player's action while a second,
    // already-submitted pending action from another player sat unresolved
    // and unaddressed by the AI GM.
    return allActed
  }

  /**
   * Self-heal for the historical exchangeNumber/currentExchange
   * divergence bug (see recordAction's comment): sweeps pending actions
   * left orphaned by it, so a scene corrupted before the fix shipped
   * doesn't stay permanently stuck showing "already submitted."
   *
   * Safety: orphaned is judged by exchangeNumber, not by
   * exchangeState.playersActed. A pending action's exchangeNumber is
   * stamped atomically in the same `playerAction.create` call that
   * inserts the row (see scene/route.ts), so it's never observably out
   * of sync with the row's own existence. playersActed used to be the
   * signal here, but it's written by a *separate*, later call
   * (recordAction) — this GET route runs opportunistically on ordinary
   * page-load/poll traffic, so it could observe a brand-new pending
   * action in the narrow window after it was created but before
   * recordAction's own write landed, read playersActed as not yet
   * containing that action's owner, and sweep a genuinely current,
   * never-narrated action to 'resolved' — silently discarding it before
   * anyone (including the submitting player) ever saw it counted.
   * exchangeNumber has no such window: anything pending whose
   * exchangeNumber doesn't match the scene's current exchange is a
   * stale leftover from an already-resolved exchange that completeExchange
   * failed to sweep, full stop.
   */
  async reconcileOrphanedActions(): Promise<string[]> {
    const scene = await prisma.scene.findUnique({
      where: { id: this.sceneId },
      include: { playerActions: { where: { status: 'pending' } } }
    })
    if (!scene || !scene.sceneResolutionText || scene.playerActions.length === 0) {
      return []
    }

    const currentExchange = scene.currentExchange ?? 0
    const orphaned = scene.playerActions.filter(a => a.exchangeNumber !== currentExchange)
    if (orphaned.length === 0) return []

    await prisma.playerAction.updateMany({
      where: { id: { in: orphaned.map(a => a.id) } },
      data: { status: 'resolved' }
    })
    return orphaned.map(a => a.id)
  }

  /**
   * Complete the current exchange and prepare for next one
   */
  async completeExchange(): Promise<void> {
    const scene = await prisma.scene.findUnique({
      where: { id: this.sceneId }
    })

    if (!scene) {
      throw new Error('Scene not found')
    }

    const currentState = (scene.exchangeState as any as ExchangeState) || {
      playersActed: [],
      // See the comment in recordAction() — `?? 0` (not `|| 1`) to
      // preserve a legitimate exchange 0.
      exchangeNumber: scene.currentExchange ?? 0,
      isComplete: false,
      complexity: 'simple',
      actionsThisExchange: 0,
      timestamp: new Date()
    }

    currentState.isComplete = true

    // Mark all pending actions for this exchange as resolved
    await prisma.playerAction.updateMany({
      where: {
        sceneId: this.sceneId,
        exchangeNumber: scene.currentExchange,
        status: 'pending'
      },
      data: {
        status: 'resolved'
      }
    })

    await prisma.scene.update({
      where: { id: this.sceneId },
      data: {
        exchangeState: currentState as any
      }
    })
  }

  /**
   * Get actions organized by priority for complex exchange resolution
   */
  async getActionsByPriority(): Promise<Record<ActionPriority, any[]>> {
    const actions = await prisma.playerAction.findMany({
      where: {
        sceneId: this.sceneId,
        exchangeNumber: (await this.getCurrentExchangeNumber()),
        status: 'pending'
      },
      include: {
        character: true,
        user: true
      },
      orderBy: {
        actionPriority: 'asc'
      }
    })

    // Group by priority
    const grouped: Record<ActionPriority, any[]> = {
      [ActionPriority.IMMEDIATE_COMBAT]: [],
      [ActionPriority.MOVEMENT]: [],
      [ActionPriority.SOCIAL]: [],
      [ActionPriority.OTHER]: []
    }

    actions.forEach(action => {
      const priority = (action.actionPriority || ActionPriority.OTHER) as ActionPriority
      grouped[priority].push(action)
    })

    return grouped
  }

  /**
   * Detect priority of an action based on content
   */
  static detectActionPriority(actionText: string): ActionPriority {
    const lower = actionText.toLowerCase()

    // Combat indicators
    if (
      lower.includes('attack') ||
      lower.includes('strike') ||
      lower.includes('defend') ||
      lower.includes('dodge') ||
      lower.includes('shoot') ||
      lower.includes('fight') ||
      lower.includes('hit')
    ) {
      return ActionPriority.IMMEDIATE_COMBAT
    }

    // Movement indicators
    if (
      lower.includes('move') ||
      lower.includes('run') ||
      lower.includes('dash') ||
      lower.includes('position') ||
      lower.includes('retreat') ||
      lower.includes('advance')
    ) {
      return ActionPriority.MOVEMENT
    }

    // Social indicators
    if (
      lower.includes('negotiate') ||
      lower.includes('persuade') ||
      lower.includes('convince') ||
      lower.includes('investigate') ||
      lower.includes('ask') ||
      lower.includes('talk') ||
      lower.includes('speak')
    ) {
      return ActionPriority.SOCIAL
    }

    return ActionPriority.OTHER
  }

  /**
   * Get current exchange number
   */
  private async getCurrentExchangeNumber(): Promise<number> {
    const scene = await prisma.scene.findUnique({
      where: { id: this.sceneId },
      select: { currentExchange: true }
    })

    return scene?.currentExchange || 0
  }

  /**
   * Get exchange state summary for UI
   */
  async getExchangeSummary(): Promise<{
    exchangeNumber: number
    playersActed: number
    totalPlayers: number
    complexity: string
    canResolve: boolean
  }> {
    const scene = await prisma.scene.findUnique({
      where: { id: this.sceneId },
      include: {
        campaign: {
          include: {
            characters: {
              where: { isAlive: true }
            }
          }
        }
      }
    })

    if (!scene) {
      throw new Error('Scene not found')
    }

    const currentState = (scene.exchangeState as any as ExchangeState) || {
      playersActed: [],
      // See the comment in recordAction() — `?? 0` (not `|| 1`) to
      // preserve a legitimate exchange 0.
      exchangeNumber: scene.currentExchange ?? 0,
      isComplete: false,
      complexity: 'simple',
      actionsThisExchange: 0,
      timestamp: new Date()
    }

    const participants = scene.participants as any
    const totalPlayers = participants?.characterIds?.length || 0

    return {
      exchangeNumber: currentState.exchangeNumber,
      playersActed: currentState.playersActed.length,
      totalPlayers,
      complexity: currentState.complexity,
      canResolve: await this.canResolveExchange()
    }
  }
}

/**
 * Zone Manager for Phase 16.6 (Optional positioning system)
 */
export class ZoneManager {
  /**
   * Update character zone position
   */
  static async updateCharacterZone(
    characterId: string,
    newZone: ZonePosition
  ): Promise<void> {
    await prisma.character.update({
      where: { id: characterId },
      data: {
        currentZone: newZone
      }
    })
  }

  /**
   * Get characters by zone in a scene
   */
  static async getCharactersByZone(sceneId: string): Promise<Record<ZonePosition, any[]>> {
    const scene = await prisma.scene.findUnique({
      where: { id: sceneId },
      include: {
        campaign: {
          include: {
            characters: {
              where: { isAlive: true }
            }
          }
        }
      }
    })

    if (!scene) {
      throw new Error('Scene not found')
    }

    const participants = scene.participants as any
    const characterIds = participants?.characterIds || []

    const characters = scene.campaign.characters.filter(c =>
      characterIds.includes(c.id)
    )

    const zoneMap: Record<ZonePosition, any[]> = {
      close: [],
      near: [],
      far: [],
      distant: []
    }

    characters.forEach(char => {
      const zone = (char.currentZone as ZonePosition) || 'near'
      zoneMap[zone].push(char)
    })

    return zoneMap
  }

  /**
   * Calculate narrative advantage based on zone positioning
   */
  static getNarrativeAdvantage(
    attackerZone: ZonePosition,
    targetZone: ZonePosition,
    actionType: 'melee' | 'ranged' | 'social'
  ): { hasAdvantage: boolean; description: string } {
    const zoneDistance = this.getZoneDistance(attackerZone, targetZone)

    if (actionType === 'melee') {
      if (zoneDistance === 0) {
        return { hasAdvantage: true, description: 'Perfect melee range' }
      } else if (zoneDistance === 1) {
        return { hasAdvantage: false, description: 'Must close distance for melee' }
      } else {
        return { hasAdvantage: false, description: 'Too far for melee attack' }
      }
    }

    if (actionType === 'ranged') {
      if (zoneDistance === 1 || zoneDistance === 2) {
        return { hasAdvantage: true, description: 'Ideal range for ranged attack' }
      } else if (zoneDistance === 0) {
        return { hasAdvantage: false, description: 'Too close for effective ranged attack' }
      } else {
        return { hasAdvantage: false, description: 'Extreme range penalty' }
      }
    }

    // Social actions work best at close/near range
    if (zoneDistance <= 1) {
      return { hasAdvantage: true, description: 'Good position for social interaction' }
    } else {
      return { hasAdvantage: false, description: 'Too far for effective communication' }
    }
  }

  /**
   * Get numeric distance between zones
   */
  private static getZoneDistance(zone1: ZonePosition, zone2: ZonePosition): number {
    const zoneOrder: ZonePosition[] = ['close', 'near', 'far', 'distant']
    const index1 = zoneOrder.indexOf(zone1)
    const index2 = zoneOrder.indexOf(zone2)
    return Math.abs(index1 - index2)
  }
}
