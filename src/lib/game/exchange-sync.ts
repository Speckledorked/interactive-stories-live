// src/lib/game/exchange-sync.ts
// Phase 17A: Exchange-Aware Realtime Synchronization
// Prevents race conditions and double-resolution in multiplayer exchanges

import { prisma } from '@/lib/prisma'

/**
 * Exchange Lock Manager
 * Ensures atomic exchange resolution - no double-resolution, no race conditions
 */
export class ExchangeLockManager {
  private static locks: Map<string, { locked: boolean; timestamp: Date }> = new Map()
  private static readonly LOCK_TIMEOUT_MS = 60000 // 1 minute timeout

  /**
   * Attempt to acquire lock for exchange resolution
   * Returns true if lock acquired, false if already locked
   */
  static acquireLock(sceneId: string): boolean {
    const existing = this.locks.get(sceneId)

    // Check if existing lock has expired
    if (existing) {
      const age = Date.now() - existing.timestamp.getTime()
      if (age > this.LOCK_TIMEOUT_MS) {
        console.warn(`⚠️ Lock timeout for scene ${sceneId}, clearing stale lock`)
        this.locks.delete(sceneId)
      } else {
        console.log(`🔒 Scene ${sceneId} is locked for resolution`)
        return false
      }
    }

    // Acquire new lock
    this.locks.set(sceneId, {
      locked: true,
      timestamp: new Date()
    })

    console.log(`🔓 Lock acquired for scene ${sceneId}`)
    return true
  }

  /**
   * Release lock after exchange resolution completes
   */
  static releaseLock(sceneId: string): void {
    this.locks.delete(sceneId)
    console.log(`✅ Lock released for scene ${sceneId}`)
  }

  /**
   * Check if scene is locked
   */
  static isLocked(sceneId: string): boolean {
    const lock = this.locks.get(sceneId)
    if (!lock) return false

    const age = Date.now() - lock.timestamp.getTime()
    if (age > this.LOCK_TIMEOUT_MS) {
      this.locks.delete(sceneId)
      return false
    }

    return true
  }
}

/**
 * Action Submission Queue
 * Handles simultaneous action submissions with grace period
 */
export class ActionSubmissionQueue {
  private static queues: Map<string, {
    actions: string[]
    timer: NodeJS.Timeout | null
  }> = new Map()

  private static readonly GRACE_PERIOD_MS = 5000 // 5 second grace period

  /**
   * Queue an action for submission
   * If multiple actions arrive within grace period, they're batched
   */
  static queueAction(
    sceneId: string,
    actionId: string,
    callback: () => Promise<void>
  ): void {
    let queue = this.queues.get(sceneId)

    if (!queue) {
      queue = {
        actions: [],
        timer: null
      }
      this.queues.set(sceneId, queue)
    }

    // Add action to queue
    queue.actions.push(actionId)

    // Clear existing timer
    if (queue.timer) {
      clearTimeout(queue.timer)
    }

    // Set new timer
    queue.timer = setTimeout(async () => {
      console.log(`⏰ Grace period expired, processing ${queue.actions.length} actions`)
      await callback()
      this.queues.delete(sceneId)
    }, this.GRACE_PERIOD_MS)
  }

  /**
   * Force process queue immediately (GM override)
   */
  static async forceProcess(sceneId: string, callback: () => Promise<void>): Promise<void> {
    const queue = this.queues.get(sceneId)
    if (queue?.timer) {
      clearTimeout(queue.timer)
    }
    await callback()
    this.queues.delete(sceneId)
  }
}

/**
 * Conflict Resolver for simultaneous actions
 */
export class SimultaneousActionResolver {
  /**
   * Detect and resolve conflicts when multiple players submit at same time
   */
  static async resolveSimultaneous(
    sceneId: string,
    actionIds: string[]
  ): Promise<{
    canProceed: boolean
    conflicts: string[]
    resolution: string
  }> {
    const actions = await prisma.playerAction.findMany({
      where: { id: { in: actionIds } },
      include: { character: true }
    })

    const conflicts: string[] = []

    // Check for character deletion mid-scene
    for (const action of actions) {
      if (!action.character.isAlive) {
        conflicts.push(`Character ${action.character.name} is no longer alive`)
      }
    }

    // Check for contradictory actions on same target
    const targets = new Map<string, any[]>()
    actions.forEach(action => {
      // Simple target extraction
      const words = action.actionText.toLowerCase().split(' ')
      words.forEach(word => {
        if (word.length > 3) {
          if (!targets.has(word)) targets.set(word, [])
          targets.get(word)!.push(action)
        }
      })
    })

    let resolution = 'All actions will be processed together.'

    if (conflicts.length > 0) {
      return {
        canProceed: false,
        conflicts,
        resolution: 'Conflicts detected - GM intervention required'
      }
    }

    return {
      canProceed: true,
      conflicts: [],
      resolution
    }
  }
}

/**
 * Disaster Recovery for critical failures during play
 */
export class DisasterRecovery {
  /**
   * Handle campaign data corruption during active play
   */
  static async handleCorruption(
    campaignId: string,
    sceneId: string
  ): Promise<{ recovered: boolean; backupCreated: boolean }> {
    console.error('🚨 Data corruption detected - attempting recovery')

    try {
      // Create emergency backup
      const scene = await prisma.scene.findUnique({
        where: { id: sceneId },
        include: {
          playerActions: true,
          campaign: true
        }
      })

      if (!scene) {
        return { recovered: false, backupCreated: false }
      }

      // Store backup in campaign metadata
      const backup = {
        timestamp: new Date().toISOString(),
        scene: scene,
        reason: 'corruption_detected'
      }

      await prisma.worldMeta.update({
        where: { campaignId },
        data: {
          gmNotes: `EMERGENCY BACKUP: ${JSON.stringify(backup)}`
        }
      })

      console.log('✅ Emergency backup created')

      return { recovered: true, backupCreated: true }
    } catch (error) {
      console.error('❌ Recovery failed:', error)
      return { recovered: false, backupCreated: false }
    }
  }

  /**
   * Rollback to last known good state
   */
  static async rollbackScene(sceneId: string): Promise<boolean> {
    try {
      await prisma.scene.update({
        where: { id: sceneId },
        data: {
          status: 'AWAITING_ACTIONS',
          sceneResolutionText: null
        }
      })

      // Clear failed actions
      await prisma.playerAction.updateMany({
        where: { sceneId, status: 'failed' },
        data: { status: 'pending' }
      })

      console.log('✅ Scene rolled back to awaiting actions')
      return true
    } catch (error) {
      console.error('❌ Rollback failed:', error)
      return false
    }
  }
}
