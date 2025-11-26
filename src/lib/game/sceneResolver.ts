// src/lib/game/sceneResolver.ts
// Main scene resolution orchestrator
// This is the heart of the AI GM system

import { prisma } from '@/lib/prisma'
import { callAIGM } from '@/lib/ai/client'
import { buildSceneResolutionRequest } from '@/lib/ai/worldState'
import { applyWorldUpdates, summarizeWorldUpdates } from './stateUpdater'
import { SceneStatus } from '@prisma/client'
import { CampaignHealthMonitor } from './campaign-health'
import { ExchangeManager } from './exchange-manager' // Phase 16
import PusherServer from '@/lib/realtime/pusher-server' // For real-time updates
import {
  computeOrganicGrowth,
  applyOrganicGrowth,
  recordStatUsage,
  validateStats,
  createAdvancementLog,
  logStatIncrease,
  logPerkGained,
  logMoveLearned,
  type RecentAction,
  type StatUsage,
  type AdvancementLog
} from './advancement'
import { AIVisualService } from '@/lib/ai/ai-visual-service'
import {
  captureWorldStateSnapshot,
  detectWorldStateChanges,
  storeWorldStateChanges,
  createCharacterProgressionNotifications
} from './world-state-tracker'

/**
 * Resolve a scene using the AI GM
 * This is the main function that:
 * 1. Gathers world state
 * 2. Calls AI GM
 * 3. Applies updates
 * 4. Marks scene as resolved
 * 
 * @param campaignId - Campaign ID
 * @param sceneId - Scene to resolve
 * @returns Resolution results
 */
/**
 * Create a timeout promise that rejects after the specified duration
 */
function createTimeout(ms: number, message: string): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(message)), ms)
  })
}

export async function resolveScene(campaignId: string, sceneId: string, forceResolve: boolean = false) {
  console.log('🎬 Starting scene resolution...')
  console.log(`Campaign: ${campaignId}`)
  console.log(`Scene: ${sceneId}`)

  // Phase 16: Check exchange readiness
  const exchangeManager = new ExchangeManager(campaignId, sceneId)
  const canResolve = await exchangeManager.canResolveExchange(forceResolve)

  if (!canResolve && !forceResolve) {
    const summary = await exchangeManager.getExchangeSummary()
    console.warn(`⏸️ Exchange not ready to resolve: ${summary.playersActed}/${summary.totalPlayers} players acted`)
    throw new Error('Not all players have acted in this exchange. GM can force resolve if needed.')
  }

  // 1. Verify scene exists and is ready to resolve
  const scene = await prisma.scene.findUnique({
    where: { id: sceneId },
    include: { playerActions: true }
  })

  if (!scene) {
    throw new Error('Scene not found')
  }

  // Allow re-resolving a stuck RESOLVING scene
  if (scene.status === 'RESOLVING') {
    console.warn(`⚠️ Scene is already RESOLVING - this might be a stuck scene from a previous failed resolution`)
    // Continue anyway to allow recovery
  } else if (scene.status !== 'AWAITING_ACTIONS') {
    throw new Error(`Scene is not ready to resolve (status: ${scene.status})`)
  }

  if (scene.playerActions.length === 0) {
    throw new Error('No player actions submitted yet')
  }

  // 2. Mark scene as resolving (prevents duplicate resolution)
  await prisma.scene.update({
    where: { id: sceneId },
    data: { status: 'RESOLVING' as SceneStatus }
  })

  console.log('✅ Scene marked as RESOLVING')

  // Wrap everything after this point in try-catch to ensure status is always reverted on error
  // Add timeout to prevent scenes from being stuck forever (1 minute)
  const RESOLUTION_TIMEOUT_MS = 60 * 1000 // 1 minute

  try {
    // Race between actual resolution and timeout
    const result = await Promise.race([
      performResolution(campaignId, sceneId, scene, exchangeManager),
      createTimeout(RESOLUTION_TIMEOUT_MS, 'Scene resolution timed out after 1 minute')
    ])

    return result
  } catch (error) {
    console.error('❌ Scene resolution failed:', error)
    console.error('Error details:', {
      name: error instanceof Error ? error.name : 'Unknown',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    })

    // CRITICAL: Always revert scene status so it can be retried
    try {
      await prisma.scene.update({
        where: { id: sceneId },
        data: { status: 'AWAITING_ACTIONS' as SceneStatus }
      })
      console.log('✅ Scene status reverted to AWAITING_ACTIONS')
    } catch (dbError) {
      console.error('❌ CRITICAL: Failed to revert scene status:', dbError)
      // Try one more time with a fresh prisma client
      try {
        await prisma.scene.update({
          where: { id: sceneId },
          data: { status: 'AWAITING_ACTIONS' as SceneStatus }
        })
        console.log('✅ Scene status reverted on retry')
      } catch (retryError) {
        console.error('❌ CRITICAL: Failed to revert scene status after retry:', retryError)
      }
    }

    // Broadcast failure via Pusher so UI can show error
    try {
      const pusher = PusherServer()
      if (pusher) {
        await pusher.trigger(`campaign-${campaignId}`, 'scene:resolution-failed', {
          sceneId,
          campaignId,
          error: error instanceof Error ? error.message : 'Unknown error',
          errorType: error instanceof Error && error.message.includes('timeout') ? 'TimeoutError' : 'Error'
        })
        console.log('📡 Broadcasted scene:resolution-failed event via Pusher')
      }
    } catch (pusherError) {
      console.error('⚠️ Failed to broadcast Pusher failure event:', pusherError)
    }

    throw error
  }
}

/**
 * Perform the actual scene resolution work
 * Separated into its own function for timeout handling
 */
async function performResolution(
  campaignId: string,
  sceneId: string,
  scene: any,
  exchangeManager: ExchangeManager
) {
  try {
    // 2.5. Broadcast resolving status via Pusher so UI updates immediately
    try {
      const pusher = PusherServer()
      if (pusher) {
        await pusher.trigger(`campaign-${campaignId}`, 'scene:resolving', {
          sceneId,
          sceneNumber: scene.sceneNumber,
          campaignId
        })
        console.log('📡 Broadcasted scene:resolving event via Pusher')
      }
    } catch (pusherError) {
      console.error('⚠️ Failed to broadcast Pusher resolving event:', pusherError)
    }

    // 3. Get world meta for turn number
    const worldMeta = await prisma.worldMeta.findUnique({
      where: { campaignId }
    })

    if (!worldMeta) {
      throw new Error('WorldMeta not found')
    }

    const currentTurn = (worldMeta as any).currentTurnNumber

    // 4. Build AI request from world state
    console.log('📊 Building AI request...')
    const aiRequest = await buildSceneResolutionRequest(campaignId, sceneId)

    // 5. Call AI GM (Phase 15: with enhanced error handling and tracking)
    console.log('🤖 Calling AI GM...')
    const debugMode = process.env.AI_DEBUG_MODE === 'true'
    const aiResponse = await callAIGM(aiRequest, campaignId, sceneId, { debugMode })

    console.log('✅ AI GM responded')
    console.log(`Scene text length: ${aiResponse.scene_text.length}`)
    console.log(`Updates: ${summarizeWorldUpdates(aiResponse)}`)

    // 5.5. Capture world state before applying updates (for transparency)
    console.log('📸 Capturing world state snapshot...')
    const beforeSnapshot = await captureWorldStateSnapshot(campaignId)

    // 6. Apply world updates to database
    console.log('💾 Applying world updates...')
    await applyWorldUpdates(campaignId, aiResponse, currentTurn)

    // 6.5. Apply organic character growth
    console.log('🌱 Processing organic character growth...')
    await applyOrganicCharacterGrowth(campaignId, sceneId, aiResponse)

    // 6.6. Detect and store world state changes for transparency
    console.log('🔍 Detecting world state changes...')
    const worldStateChanges = await detectWorldStateChanges(campaignId, beforeSnapshot)
    await storeWorldStateChanges(sceneId, worldStateChanges)
    console.log(`✅ Tracked ${worldStateChanges.length} world state changes`)

    // 6.7. Create notifications for character progression
    const characterChanges = worldStateChanges.filter(c => c.category === 'character')
    for (const change of characterChanges) {
      // Find the character ID from the name
      const character = await prisma.character.findFirst({
        where: {
          campaignId,
          name: change.entityName
        }
      })
      if (character) {
        await createCharacterProgressionNotifications(
          campaignId,
          character.id,
          [change],
          scene.sceneNumber
        )
      }
    }
    console.log(`✅ Created ${characterChanges.length} progression notifications`)

    // 7. Store scene resolution (append to existing resolutions)
    const existingResolutions = scene.sceneResolutionText ? [scene.sceneResolutionText] : []
    const allResolutions = [...existingResolutions, aiResponse.scene_text].join('\n\n---\n\n')

    await prisma.scene.update({
      where: { id: sceneId },
      data: {
        sceneResolutionText: allResolutions,
        status: 'AWAITING_ACTIONS' as SceneStatus // Keep scene active for continuous play
      }
    })

    console.log('✅ Scene resolution stored, scene continues...')

    // 7.1. Broadcast scene resolution via Pusher IMMEDIATELY after status update
    // This ensures the frontend gets notified right away, before any heavyweight operations
    try {
      const pusher = PusherServer()
      if (pusher) {
        await pusher.trigger(`campaign-${campaignId}`, 'scene:resolved', {
          sceneId,
          sceneNumber: scene.sceneNumber,
          campaignId,
          resolutionPreview: aiResponse.scene_text.substring(0, 200) + '...'
        })
        console.log('📡 Broadcasted scene:resolved event via Pusher')
      }
    } catch (pusherError) {
      // Don't fail the resolution if Pusher fails
      console.error('⚠️ Failed to broadcast Pusher event:', pusherError)
    }

    // 7.5. Generate map visualization from scene description
    try {
      console.log('🗺️  Generating map visualization...')

      // Get the active map for the campaign (if any)
      const activeMap = await prisma.map.findFirst({
        where: {
          campaignId,
          isActive: true
        },
        select: { id: true }
      })

      await AIVisualService.generateMapFromScene(
        aiResponse.scene_text,
        campaignId,
        activeMap?.id
      )

      console.log('✅ Map visualization generated')
    } catch (visualError) {
      // Don't fail the entire scene resolution if map generation fails
      console.error('⚠️  Map generation failed (non-critical):', visualError)
    }

    // Phase 16: Complete the current exchange and start a new one
    await exchangeManager.completeExchange()
    console.log('🔄 Exchange completed')

    // Initialize next exchange for continuous play
    await exchangeManager.initializeExchange()
    console.log('🔄 Next exchange initialized')

    // 8. Increment turn number and update in-game date based on AI time passage
    const timePassage = aiResponse.time_passage || {}
    let newInGameDate = worldMeta.currentInGameDate || 'Day 1'

    // Calculate new date based on AI's determination
    if (timePassage.new_date) {
      newInGameDate = timePassage.new_date
    } else if (timePassage.days || timePassage.hours) {
      // Parse current date and add time
      newInGameDate = calculateNewDate(
        worldMeta.currentInGameDate || 'Day 1',
        timePassage.days || 0,
        timePassage.hours || 0
      )
    }

    await prisma.worldMeta.update({
      where: { id: worldMeta.id },
      data: {
        currentTurnNumber: currentTurn + 1,
        currentInGameDate: newInGameDate
      }
    })

    console.log(`✅ Turn incremented: ${currentTurn} → ${currentTurn + 1}`)
    if (timePassage.days || timePassage.hours) {
      console.log(`⏰ Time passed: ${timePassage.days || 0} days, ${timePassage.hours || 0} hours`)
      console.log(`📅 New date: ${newInGameDate}`)
    }

    // 8.5. Generate campaign log entry
    try {
      console.log('📝 Generating campaign log entry...')
      await generateCampaignLog(campaignId, sceneId, currentTurn + 1, aiResponse.scene_text)
      console.log('✅ Campaign log entry created')
    } catch (logError) {
      // Don't fail the entire scene resolution if log generation fails
      console.error('⚠️  Campaign log generation failed (non-critical):', logError)
    }

    // Phase 15.4: Check campaign health periodically
    if (currentTurn % 5 === 0) { // Check every 5 scenes
      console.log('🏥 Running campaign health check...')
      const healthMonitor = new CampaignHealthMonitor(campaignId)
      const health = await healthMonitor.calculateHealth()
      await healthMonitor.recordHealthCheck(health)

      if (!health.isHealthy) {
        console.warn('⚠️ Campaign health issues detected:')
        health.issues.forEach(issue => console.warn(`  - ${issue}`))
        console.warn('💡 Recommendations:')
        health.recommendations.forEach(rec => console.warn(`  - ${rec}`))
      } else {
        console.log(`✅ Campaign health: ${health.score}/100`)
      }
    }

    return {
      success: true,
      sceneText: aiResponse.scene_text,
      updates: summarizeWorldUpdates(aiResponse),
      newTurnNumber: currentTurn + 1
    }
  } catch (error) {
    // Just re-throw the error - it will be caught by the outer try-catch in resolveScene
    // which will handle status reversion and Pusher notifications
    throw error
  }
}

/**
 * Create a new scene for a campaign
 * This starts the next "chapter" of the story
 * 
 * @param campaignId - Campaign to create scene for
 * @returns New scene object
 */
export async function createNewScene(campaignId: string, characterIds?: string[]) {
  console.log('🎭 Creating new scene...')

  // Get the highest scene number
  const lastScene = await prisma.scene.findFirst({
    where: { campaignId },
    orderBy: { sceneNumber: 'desc' }
  })

  const nextSceneNumber = (lastScene?.sceneNumber || 0) + 1

  // Prepare participants data
  let participants: any = null
  let waitingOnUsers: any = null

  if (characterIds && characterIds.length > 0) {
    // Get user IDs for the characters
    const characters = await prisma.character.findMany({
      where: { id: { in: characterIds } },
      select: { id: true, userId: true }
    })

    const userIds = [...new Set(characters.map(c => c.userId))]

    participants = {
      characterIds,
      userIds
    }

    waitingOnUsers = userIds

    console.log(`📋 Scene participants: ${characterIds.length} characters, ${userIds.length} users`)
  }

  // Generate scene intro using AI (imported from worldState.ts)
  const { generateNewSceneIntro } = await import('@/lib/ai/worldState')
  console.log('🤖 Generating scene intro...')
  const sceneIntro = await generateNewSceneIntro(campaignId)

  // Create the scene
  const newScene = await prisma.scene.create({
    data: {
      campaignId,
      sceneNumber: nextSceneNumber,
      sceneIntroText: sceneIntro,
      status: 'AWAITING_ACTIONS' as SceneStatus,
      participants: participants as any,
      waitingOnUsers: waitingOnUsers as any
    }
  })

  console.log(`✅ Scene ${nextSceneNumber} created`)

  return newScene
}

/**
 * Get the current active scene for a campaign
 * Used by frontend to know what scene to show
 */
export async function getCurrentScene(campaignId: string) {
  return prisma.scene.findFirst({
    where: {
      campaignId,
      status: { in: ['AWAITING_ACTIONS', 'RESOLVING'] }
    },
    include: {
      playerActions: {
        include: {
          character: true,
          user: { select: { id: true, email: true } }
        }
      }
    },
    orderBy: { sceneNumber: 'desc' }
  })
}

/**
 * Get recently resolved scenes for display
 */
export async function getRecentScenes(campaignId: string, limit: number = 5) {
  return prisma.scene.findMany({
    where: {
      campaignId,
      status: 'RESOLVED'
    },
    include: {
      playerActions: {
        include: {
          character: { select: { name: true } },
          user: { select: { email: true } }
        }
      }
    },
    orderBy: { sceneNumber: 'desc' },
    take: limit
  })
}

/**
 * Check if a user can trigger scene resolution
 * Only admins can resolve scenes
 */
export async function canUserResolveScene(
  userId: string,
  campaignId: string
): Promise<boolean> {
  const membership = await prisma.campaignMembership.findUnique({
    where: {
      userId_campaignId: {
        userId,
        campaignId
      }
    }
  })

  return membership?.role === 'ADMIN'
}

/**
 * Apply organic character growth after scene resolution
 * This processes:
 * 1. AI-suggested organic_advancement from the response
 * 2. System-computed growth based on action patterns
 */
async function applyOrganicCharacterGrowth(
  campaignId: string,
  sceneId: string,
  aiResponse: any
): Promise<void> {
  // Get all characters who acted in this scene
  const scene = await prisma.scene.findUnique({
    where: { id: sceneId },
    include: {
      playerActions: {
        include: {
          character: true
        }
      }
    }
  })

  if (!scene || scene.playerActions.length === 0) {
    console.log('  No player actions to process')
    return
  }

  // Group actions by character
  const actionsByCharacter = new Map<string, any[]>()
  for (const action of scene.playerActions) {
    const charId = action.characterId
    if (!actionsByCharacter.has(charId)) {
      actionsByCharacter.set(charId, [])
    }
    actionsByCharacter.get(charId)!.push(action)
  }

  // Process each character
  for (const [characterId, actions] of actionsByCharacter.entries()) {
    const character = actions[0].character

    // Build recent action summary
    // For now, we'll infer tags and outcomes from action text
    // In a more advanced system, you'd store this with the action
    const recentActions: RecentAction[] = actions.map(action => ({
      actionId: action.id,
      tags: extractTagsFromAction(action.actionText),
      statUsed: null, // TODO: extract from rollResult if available
      outcome: inferOutcomeFromAction(action)
    }))

    // Update stat usage
    let updatedStatUsage = character.statUsage as StatUsage
    for (const action of recentActions) {
      if (action.statUsed && action.outcome) {
        updatedStatUsage = recordStatUsage(updatedStatUsage, action.statUsed, action.outcome)
      }
    }

    // Compute system-based growth suggestions
    const systemGrowth = computeOrganicGrowth(character, recentActions)

    // Check if AI suggested growth for this character
    const aiGrowth = aiResponse.world_updates?.organic_advancement?.find(
      (adv: any) => adv.character_id === characterId
    )

    // Merge AI and system suggestions
    const mergedGrowth = {
      statIncreases: [
        ...(systemGrowth.statIncreases || []),
        ...(aiGrowth?.stat_increases || [])
      ],
      newPerks: [
        ...(systemGrowth.newPerks || []),
        ...(aiGrowth?.new_perks || [])
      ],
      newMoves: [
        ...(systemGrowth.newMoves || []),
        ...(aiGrowth?.new_moves || [])
      ]
    }

    // Apply growth if there are any changes
    if (
      mergedGrowth.statIncreases.length > 0 ||
      mergedGrowth.newPerks.length > 0 ||
      mergedGrowth.newMoves.length > 0
    ) {
      const applied = applyOrganicGrowth(character, mergedGrowth)

      // Get or create advancement log
      let advancementLog: AdvancementLog = (character.advancementLog as any) || createAdvancementLog()

      // Get turn number for logging
      const worldMeta = await prisma.worldMeta.findUnique({
        where: { campaignId }
      })
      const turnNumber = worldMeta?.currentTurnNumber

      // Log all stat increases
      const oldStats = (character.stats as Record<string, number>) || {}
      for (const statIncrease of mergedGrowth.statIncreases) {
        const oldValue = oldStats[statIncrease.statKey] || 0
        const newValue = applied.updatedStats[statIncrease.statKey] || 0
        if (newValue !== oldValue) {
          advancementLog = logStatIncrease(
            advancementLog,
            statIncrease.statKey,
            oldValue,
            newValue,
            statIncrease.reason,
            turnNumber,
            sceneId
          )
        }
      }

      // Log all new perks
      for (const perk of mergedGrowth.newPerks) {
        advancementLog = logPerkGained(
          advancementLog,
          perk.id,
          perk.name,
          `Earned through play`,
          turnNumber,
          sceneId
        )
      }

      // Log all new moves
      for (const move of mergedGrowth.newMoves) {
        advancementLog = logMoveLearned(
          advancementLog,
          move,
          `Demonstrated mastery`,
          turnNumber,
          sceneId
        )
      }

      // Update character in database
      await prisma.character.update({
        where: { id: characterId },
        data: {
          statUsage: updatedStatUsage,
          stats: applied.updatedStats,
          perks: applied.updatedPerks,
          moves: applied.updatedMoves,
          advancementLog: advancementLog as any
        }
      })

      console.log(`  ✅ Applied growth to ${character.name}`)
    } else {
      // Just update stat usage
      await prisma.character.update({
        where: { id: characterId },
        data: {
          statUsage: updatedStatUsage
        }
      })
    }
  }
}

/**
 * Extract tags from action text using simple keyword matching
 * In production, you might use NLP or have players tag actions explicitly
 */
function extractTagsFromAction(actionText: string): string[] {
  const text = actionText.toLowerCase()
  const tags: string[] = []

  // Combat keywords
  if (text.match(/\b(attack|fight|combat|battle|strike|hit|shoot|fire)\b/)) {
    tags.push('combat')
  }

  // Stealth keywords
  if (text.match(/\b(sneak|hide|stealth|infiltrate|slip|shadow|quiet)\b/)) {
    tags.push('stealth')
  }

  // Investigation keywords
  if (text.match(/\b(investigate|search|examine|look|study|analyze|inspect)\b/)) {
    tags.push('investigation')
  }

  // Social keywords
  if (text.match(/\b(talk|persuade|convince|negotiate|charm|intimidate|deceive)\b/)) {
    tags.push('social')
  }

  // Training keywords
  if (text.match(/\b(train|practice|study|learn|improve|exercise)\b/)) {
    tags.push('training')
  }

  // Spying keywords
  if (text.match(/\b(spy|surveil|watch|observe|follow|track)\b/)) {
    tags.push('spying')
  }

  return tags
}

/**
 * Infer outcome from action
 * In production, this would be stored with dice rolls
 */
function inferOutcomeFromAction(action: any): 'success' | 'mixed' | 'failure' | undefined {
  // Check if there's a rollResult
  if (action.rollResult) {
    const result = action.rollResult
    if (result.outcome === 'strongHit') return 'success'
    if (result.outcome === 'weakHit') return 'mixed'
    if (result.outcome === 'miss') return 'failure'
  }

  // Default: assume mixed success if no roll data
  return 'mixed'
}

/**
 * Generate a campaign log entry summarizing the scene
 */
async function generateCampaignLog(
  campaignId: string,
  sceneId: string,
  turnNumber: number,
  sceneText: string
): Promise<void> {
  // Create a simple summary by taking the first few sentences or using a simple format
  // In a production system, you'd call an AI to generate a proper summary

  const sentences = sceneText.split(/[.!?]+/).filter(s => s.trim().length > 0)
  const summary = sentences.slice(0, 3).join('. ') + (sentences.length > 3 ? '...' : '')

  // Extract key moments (looking for character actions, significant events)
  const highlights: string[] = []
  const actionKeywords = ['fought', 'discovered', 'found', 'defeated', 'rescued', 'escaped', 'learned', 'met', 'confronted']

  sentences.forEach(sentence => {
    const lowerSentence = sentence.toLowerCase()
    if (actionKeywords.some(keyword => lowerSentence.includes(keyword))) {
      highlights.push(sentence.trim())
    }
  })

  // Get scene info for title
  const scene = await prisma.scene.findUnique({
    where: { id: sceneId },
    select: { sceneNumber: true }
  })

  const title = scene ? `Scene ${scene.sceneNumber}` : `Turn ${turnNumber}`

  await prisma.campaignLog.create({
    data: {
      campaignId,
      sceneId,
      turnNumber,
      title,
      summary,
      highlights: highlights.slice(0, 5), // Limit to 5 highlights
      entryType: 'scene'
    }
  })
}

/**
 * Calculate new in-game date based on time passage
 * Handles simple date formats like "Day X" or more complex dates
 */
function calculateNewDate(currentDate: string, daysToAdd: number, hoursToAdd: number): string {
  // Handle "Day X" format
  const dayMatch = currentDate.match(/Day (\d+)/)
  if (dayMatch) {
    const currentDay = parseInt(dayMatch[1])
    const totalDays = currentDay + daysToAdd + Math.floor(hoursToAdd / 24)
    const remainingHours = hoursToAdd % 24

    if (remainingHours > 0) {
      return `Day ${totalDays}, ${remainingHours}:00`
    }
    return `Day ${totalDays}`
  }

  // Handle "Day X, HH:MM" format
  const dayTimeMatch = currentDate.match(/Day (\d+), (\d+):(\d+)/)
  if (dayTimeMatch) {
    const currentDay = parseInt(dayTimeMatch[1])
    const currentHour = parseInt(dayTimeMatch[2])
    const currentMinute = parseInt(dayTimeMatch[3])

    const totalHours = currentHour + hoursToAdd + (daysToAdd * 24)
    const newDay = currentDay + Math.floor(totalHours / 24)
    const newHour = totalHours % 24

    return `Day ${newDay}, ${newHour.toString().padStart(2, '0')}:${currentMinute.toString().padStart(2, '0')}`
  }

  // Fallback: just append time passage description
  if (daysToAdd > 0 && hoursToAdd > 0) {
    return `${currentDate} + ${daysToAdd}d ${hoursToAdd}h`
  } else if (daysToAdd > 0) {
    return `${currentDate} + ${daysToAdd} days`
  } else if (hoursToAdd > 0) {
    return `${currentDate} + ${hoursToAdd} hours`
  }

  return currentDate
}

/**
 * Update wiki entries based on scene resolution
 * This syncs NPCs, factions, and other entities mentioned in the AI response
 */
async function updateWikiEntries(
  campaignId: string,
  turnNumber: number,
  aiResponse: any
): Promise<void> {
  // Get existing NPCs and Factions from database
  const [npcs, factions] = await Promise.all([
    prisma.nPC.findMany({ where: { campaignId } }),
    prisma.faction.findMany({ where: { campaignId } })
  ])

  // Update or create NPC wiki entries
  for (const npc of npcs) {
    const existing = await prisma.wikiEntry.findFirst({
      where: {
        campaignId,
        entryType: 'NPC',
        name: npc.name
      }
    })

    if (existing) {
      // Update last seen turn
      await prisma.wikiEntry.update({
        where: { id: existing.id },
        data: {
          lastSeenTurn: turnNumber,
          updatedAt: new Date()
        }
      })
    } else {
      // Create new entry
      await prisma.wikiEntry.create({
        data: {
          campaignId,
          entryType: 'NPC',
          name: npc.name,
          summary: npc.description || `A character in the story`,
          description: npc.description || `${npc.name} is a character encountered during the adventure.`,
          tags: [],
          aliases: [],
          importance: 'normal',
          lastSeenTurn: turnNumber,
          createdBy: 'ai'
        }
      })
    }
  }

  // Update or create Faction wiki entries
  for (const faction of factions) {
    const existing = await prisma.wikiEntry.findFirst({
      where: {
        campaignId,
        entryType: 'FACTION',
        name: faction.name
      }
    })

    if (existing) {
      await prisma.wikiEntry.update({
        where: { id: existing.id },
        data: {
          lastSeenTurn: turnNumber,
          updatedAt: new Date()
        }
      })
    } else {
      await prisma.wikiEntry.create({
        data: {
          campaignId,
          entryType: 'FACTION',
          name: faction.name,
          summary: faction.description || `A faction in the campaign`,
          description: faction.description || `${faction.name} is a group or organization in the world.`,
          tags: [],
          aliases: [],
          importance: 'normal',
          lastSeenTurn: turnNumber,
          createdBy: 'ai'
        }
      })
    }
  }

  // Update clock entries
  const clocks = await prisma.clock.findMany({ where: { campaignId } })
  for (const clock of clocks) {
    const existing = await prisma.wikiEntry.findFirst({
      where: {
        campaignId,
        entryType: 'CLOCK',
        name: clock.name
      }
    })

    const progress = `${clock.currentTicks}/${clock.maxTicks}`
    const clockDesc = `${clock.description}\n\nProgress: ${progress}`

    if (existing) {
      await prisma.wikiEntry.update({
        where: { id: existing.id },
        data: {
          description: clockDesc,
          lastSeenTurn: turnNumber,
          updatedAt: new Date()
        }
      })
    } else {
      await prisma.wikiEntry.create({
        data: {
          campaignId,
          entryType: 'CLOCK',
          name: clock.name,
          summary: clock.description || 'A countdown or progress tracker',
          description: clockDesc,
          tags: [],
          aliases: [],
          importance: 'major',
          lastSeenTurn: turnNumber,
          createdBy: 'ai'
        }
      })
    }
  }
}
