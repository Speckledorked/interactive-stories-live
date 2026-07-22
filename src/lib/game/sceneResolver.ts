// src/lib/game/sceneResolver.ts
// Main scene resolution orchestrator
// This is the heart of the AI GM system

import { prisma } from '@/lib/prisma'
import { callAIGM } from '@/lib/ai/client'
import { buildSceneResolutionRequest } from '@/lib/ai/worldState'
import { applyWorldUpdates, summarizeWorldUpdates, enrichStubNPCs, enrichStubFactions } from './stateUpdater'
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
  buildMoveFromAI,
  buildPerkFromAI,
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
import { createSceneMemory } from '@/lib/ai/memoryCreation'
import { extractAndApplyConsequences } from './consequences'
import { formatRollReceipt } from './resolution'
import { elapsedInGameHours } from './tick/pacing'
import { ensureSurgeCorruptionChanges } from './corruption'
import { aggregateInventoryItems, describeAggregatedItem } from './itemRegistry'
import { reportError } from '@/lib/monitoring'
import { checkAndCreateMilestone } from './campaignMilestone'

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

  // X-Card pause (see lib/safety/safety-service.ts) — enforced here rather
  // than only at the route level since resolveScene has multiple entry
  // points (end-scene route, the async resolution queue worker).
  if (scene.isPaused) {
    throw new Error('Scene is paused for a safety check-in. A GM must resume it before resolution can continue.')
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
  // Add timeout to prevent scenes from being stuck forever
  const RESOLUTION_TIMEOUT_MS = 150 * 1000 // 150 seconds (increased to handle RAG retrieval + AI calls)

  try {
    // Race between actual resolution and timeout
    const result = await Promise.race([
      performResolution(campaignId, sceneId, scene, exchangeManager),
      createTimeout(RESOLUTION_TIMEOUT_MS, 'Scene resolution timed out after 150 seconds')
    ])

    return result
  } catch (error) {
    console.error('❌ Scene resolution failed:', error)
    console.error('Error details:', {
      name: error instanceof Error ? error.name : 'Unknown',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    })
    await reportError('scene-resolution-failed', error, { campaignId, sceneId })

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
          campaignId,
          message: 'The AI GM is processing your actions. This usually takes 10-30 seconds...'
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

    // 5.9. Corruption surge backstop: any roll powered by an accepted
    // bargain MUST cost its mark this scene, whether or not the narrator
    // remembered to report corruption_change — inject it if missing.
    const surgedCharacters = (aiRequest.action_mechanics || [])
      .filter(m => m.corruptionSurgeBonus > 0)
      .map(m => ({ characterId: m.characterId, characterName: m.characterName }))
    if (surgedCharacters.length > 0) {
      ensureSurgeCorruptionChanges(aiResponse.world_updates as any, surgedCharacters)
      console.log(`😈 Corruption surge invoked by: ${surgedCharacters.map(c => c.characterName).join(', ')}`)
    }

    // 6. Apply world updates to database
    console.log('💾 Applying world updates...')
    const { involvedNpcIds, involvedFactionIds } = await applyWorldUpdates(campaignId, aiResponse, currentTurn)

    // 6.1. Enrich any stub NPCs/factions auto-created mid-scene (non-blocking, best-effort)
    enrichStubNPCs(campaignId, aiResponse.scene_text).catch(err =>
      console.warn('NPC enrichment error (ignored):', err)
    )
    enrichStubFactions(campaignId, aiResponse.scene_text).catch(err =>
      console.warn('Faction enrichment error (ignored):', err)
    )

    // 6.2. Extract and apply player-action consequences to NPCs/Factions
    // Add timeout to prevent this from blocking scene resolution
    try {
      console.log('⚖️  Extracting player-action consequences...')

      const CONSEQUENCE_TIMEOUT_MS = 20 * 1000
      const consequencePromise = extractAndApplyConsequences(
        campaignId,
        currentTurn + 1,
        aiResponse.scene_text
      )
      const consequenceTimeoutPromise = new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('Consequence extraction timeout')), CONSEQUENCE_TIMEOUT_MS)
      )

      await Promise.race([consequencePromise, consequenceTimeoutPromise])

      console.log('✅ Consequences applied')
    } catch (consequenceError) {
      const errorMsg = consequenceError instanceof Error ? consequenceError.message : String(consequenceError)
      console.error('⚠️  Consequence extraction failed (non-critical):', errorMsg)
    }

    // 6.5. Apply organic character growth
    console.log('🌱 Processing organic character growth...')
    await applyOrganicCharacterGrowth(campaignId, sceneId, aiResponse)

    // 6.6. Detect and store world state changes for transparency
    console.log('🔍 Detecting world state changes...')
    const worldStateChanges = await detectWorldStateChanges(campaignId, beforeSnapshot)

    // Roll receipts: the mechanics stay out of the prose on purpose, so
    // the opt-in transparency panel is the one place a player can verify
    // what was rolled and why the scene went the way it did.
    for (const m of aiRequest.action_mechanics || []) {
      worldStateChanges.push({
        category: 'roll',
        type: 'rolled',
        entityName: m.characterName,
        details: formatRollReceipt(m),
        impact: m.outcome === 'miss' ? 'major' : m.outcome === 'weakHit' ? 'moderate' : 'minor'
      })
    }

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

    // 7.5. Generate map visualization from scene description — only on a
    // scene's FIRST exchange. A scene can resolve several exchanges
    // before the party moves on ("Keep scene active for continuous
    // play"), and the map doesn't need to be re-derived from scratch on
    // every single one — it was previously called here on every exchange
    // regardless, which burned an AI call and a batch of zone/token
    // writes on every action, not just when a genuinely new scene
    // actually started.
    if (!isFirstSceneExchange(existingResolutions)) {
      console.log('🗺️  Skipping map generation — scene already has a map from its first exchange')
    } else {
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

        // Timeout map generation after 30 seconds
        const MAP_TIMEOUT_MS = 30 * 1000
        const mapPromise = AIVisualService.generateMapFromScene(
          aiResponse.scene_text,
          campaignId,
          activeMap?.id
        )

        const mapTimeoutPromise = new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('Map generation timeout')), MAP_TIMEOUT_MS)
        )

        await Promise.race([mapPromise, mapTimeoutPromise])

        console.log('✅ Map visualization generated')
      } catch (visualError) {
        // Don't fail the entire scene resolution if map generation fails
        const errorMsg = visualError instanceof Error ? visualError.message : String(visualError)
        console.error('⚠️  Map generation failed (non-critical):', errorMsg)
      }
    }

    // 7.6. Sync wiki entries for NPCs, factions, and clocks (non-critical)
    try {
      await updateWikiEntries(campaignId, currentTurn, aiResponse)
      console.log('📖 Wiki entries synced')
    } catch (wikiError) {
      console.error('⚠️  Wiki sync failed (non-critical):', wikiError)
    }

    // Phase 16: Complete the current exchange and start a new one
    await exchangeManager.completeExchange()
    console.log('🔄 Exchange completed')

    // Initialize next exchange for continuous play
    await exchangeManager.initializeExchange()
    console.log('🔄 Next exchange initialized')

    // 8. Increment turn number and update in-game date based on AI time passage
    const timePassage = aiResponse.time_passage || {}

    // hoursThisExchange is the single source of truth for how much in-game
    // time this scene advanced — clamped by elapsedInGameHours (see
    // tick/pacing.ts) so the displayed date and the banked world-turn clock
    // can never desync, and a single scene can't jump either one an
    // absurd amount.
    const hoursThisExchange = elapsedInGameHours(timePassage)
    const newInGameDate = hoursThisExchange > 0
      ? calculateNewDate(worldMeta.currentInGameDate || 'Day 1', hoursThisExchange)
      : (worldMeta.currentInGameDate || 'Day 1')

    // Bank this exchange's in-game time toward the next world turn — the
    // faction/NPC simulation advances with fiction time, not per action
    // (see lib/game/tick/pacing.ts and runWorldTurnIfDue).

    await prisma.worldMeta.update({
      where: { id: worldMeta.id },
      data: {
        currentTurnNumber: currentTurn + 1,
        currentInGameDate: newInGameDate,
        hoursSinceWorldTurn: { increment: hoursThisExchange },
        // Tracks what play itself has banked since the last heartbeat sweep,
        // so the sweep can top up to real elapsed time instead of stacking
        // on top of active play (see lib/game/cronHeartbeat.ts).
        hoursBankedSinceLastHeartbeat: { increment: hoursThisExchange }
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
      await generateCampaignLog(
        campaignId,
        sceneId,
        currentTurn + 1,
        aiResponse.scene_text,
        aiResponse.scene_summary,
        aiResponse.world_updates?.new_timeline_events
      )
      console.log('✅ Campaign log entry created')
    } catch (logError) {
      // Don't fail the entire scene resolution if log generation fails
      console.error('⚠️  Campaign log generation failed (non-critical):', logError)
    }

    // 8.6. Create campaign memory for RAG retrieval
    // Add timeout to prevent memory creation from blocking scene resolution
    try {
      console.log('🧠 Creating campaign memory...')

      // Timeout memory creation after 20 seconds
      const MEMORY_CREATE_TIMEOUT_MS = 20 * 1000
      const memoryCreatePromise = createSceneMemory(
        { ...scene, sceneResolutionText: aiResponse.scene_text },
        { turnNumber: currentTurn + 1 },
        aiResponse,
        { npcIds: involvedNpcIds, factionIds: involvedFactionIds }
      )

      const memoryCreateTimeoutPromise = new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('Memory creation timeout')), MEMORY_CREATE_TIMEOUT_MS)
      )

      await Promise.race([memoryCreatePromise, memoryCreateTimeoutPromise])

      console.log('✅ Campaign memory created')
    } catch (memoryError) {
      // Don't fail the entire scene resolution if memory creation fails
      const errorMsg = memoryError instanceof Error ? memoryError.message : String(memoryError)
      console.error('⚠️  Campaign memory creation failed (non-critical):', errorMsg)
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
      userIds,
      // Distinguishes a GM-scoped roster (Character-Focused/split-party —
      // stays closed to everyone else, forever) from an open scene's
      // participants, which starts null and grows as people act (see
      // scene/route.ts). Both end up as the same-shaped
      // {characterIds, userIds} object, so without this flag there was no
      // way to tell "deliberately closed at creation" from "open scene
      // that merely has its first joiner" — every downstream check that
      // reads participants.characterIds treated the two identically,
      // wrongly locking an open scene closed the moment anyone acted.
      scoped: true
    }

    waitingOnUsers = userIds

    console.log(`📋 Scene participants: ${characterIds.length} characters, ${userIds.length} users`)
  }

  // Generate scene intro using AI (imported from worldState.ts) — scoped
  // to this scene's own participants when it has an explicit list (a
  // split-party or Character-Focused scene), so it doesn't introduce
  // characters who aren't actually part of it.
  const { generateNewSceneIntro } = await import('@/lib/ai/worldState')
  console.log('🤖 Generating scene intro...')
  const sceneIntro = await generateNewSceneIntro(campaignId, characterIds)

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

  // Only THIS exchange's actions. This runs before completeExchange()
  // flips them to 'resolved', so 'pending' is exactly the set that was
  // just rolled and narrated. Without this filter, every earlier
  // exchange's rolls in a long-running scene would be re-counted into
  // statUsage on each new resolution, inflating growth quadratically.
  const currentExchangeActions = scene.playerActions.filter(a => a.status === 'pending')
  if (currentExchangeActions.length === 0) {
    console.log('  No pending actions this exchange')
    return
  }

  // Group actions by character
  const actionsByCharacter = new Map<string, any[]>()
  for (const action of currentExchangeActions) {
    const charId = action.characterId
    if (!actionsByCharacter.has(charId)) {
      actionsByCharacter.set(charId, [])
    }
    actionsByCharacter.get(charId)!.push(action)
  }

  // Process each character
  for (const [characterId, actions] of actionsByCharacter.entries()) {
    const character = actions[0].character

    // Build recent action summary (for stat usage tracking only — perks
    // and moves are AI-authored, not inferred from action text here)
    const recentActions: RecentAction[] = actions.map(action => ({
      actionId: action.id,
      statUsed: (action.rollResult as any)?.stat ?? null,
      outcome: inferOutcomeFromAction(action)
    }))

    // Update stat usage
    let updatedStatUsage = character.statUsage as StatUsage
    for (const action of recentActions) {
      if (action.statUsed && action.outcome) {
        updatedStatUsage = recordStatUsage(updatedStatUsage, action.statUsed, action.outcome)
      }
    }

    // Turn number gates both stat-growth cooldown (computeOrganicGrowth)
    // and advancement log entries — fetched once, up front, for both.
    const worldMeta = await prisma.worldMeta.findUnique({
      where: { campaignId }
    })
    const turnNumber = worldMeta?.currentTurnNumber ?? 0

    // Compute system-based growth suggestions (stat increases only)
    const systemGrowth = computeOrganicGrowth(character, turnNumber)

    // Check if AI suggested growth for this character
    const aiGrowth = aiResponse.world_updates?.organic_advancement?.find(
      (adv: any) => adv.character_id === characterId
    )

    // Merge AI and system suggestions. AI-reported perks/moves arrive as
    // bare {name, description/trigger, ...} — buildPerkFromAI/
    // buildMoveFromAI derive a stable id from the name so the same
    // conceptual perk/move dedupes across scenes even if the AI phrases it
    // slightly differently each time.
    const mergedGrowth = {
      statIncreases: [
        ...(systemGrowth.statIncreases || []),
        ...(aiGrowth?.stat_increases || [])
      ],
      newPerks: (aiGrowth?.new_perks || []).map(buildPerkFromAI),
      newMoves: [
        ...(systemGrowth.newMoves || []),
        ...((aiGrowth?.new_moves || []).map(buildMoveFromAI))
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

      // Log all stat increases, and stamp lastGrowthTurn on each one that
      // actually applied so computeOrganicGrowth's arc-cooldown gate has
      // something to check next time (see advancement.ts StatUsage).
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
          if (updatedStatUsage && updatedStatUsage[statIncrease.statKey]) {
            updatedStatUsage[statIncrease.statKey].lastGrowthTurn = turnNumber
          }
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
          move.id,
          move.name,
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
          moves: applied.updatedMoves as any,
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

// A scene stays open across several exchanges ("Keep scene active for
// continuous play" above) - the log entry for it should read as one
// growing recap of the scene, not restart from scratch each exchange.
// Bounded by sentence count (not raw chars) so a very long-running scene
// doesn't grow the row forever, and so the cap can never land mid-sentence
// the way the old truncation bug did - it drops the OLDEST complete
// sentences first, keeping the most recent context.
const MAX_SUMMARY_SENTENCES_PER_SCENE = 10
const MAX_HIGHLIGHTS_PER_SCENE = 8

export function appendSummarySegment(existingSummary: string, newSegment: string): string {
  const combined = `${existingSummary} ${newSegment}`.trim()
  const sentences = combined.match(/[^.!?]+[.!?]+/g)
  if (!sentences || sentences.length <= MAX_SUMMARY_SENTENCES_PER_SCENE) return combined
  return sentences.slice(-MAX_SUMMARY_SENTENCES_PER_SCENE).map(s => s.trim()).join(' ')
}

/**
 * Generate (or extend) the campaign log entry for a scene.
 *
 * Prefers the AI's own genuine recap (scene_summary) and named beats
 * (new_timeline_events' titles) — both already produced in the same
 * resolution call, so this costs nothing extra. Falls back to a crude
 * first-few-sentences truncation of scene_text only when those are
 * missing (a repaired/degraded response never includes them) — that
 * truncation used to be the only path, which is why old log entries read
 * as raw prose cut off mid-quote rather than an actual summary.
 *
 * One entry per scene, not per exchange: a scene can resolve several
 * exchanges before the party moves on, and scene_summary only describes
 * the exchange that just resolved — creating a fresh row every time
 * produced a wall of near-duplicate "Scene N" entries, each re-narrating
 * the same ongoing fight/conversation one beat later. An existing entry
 * for this sceneId is extended (summary appended, highlights merged)
 * instead of a new row being created.
 */
async function generateCampaignLog(
  campaignId: string,
  sceneId: string,
  turnNumber: number,
  sceneText: string,
  sceneSummary?: string,
  timelineEvents?: Array<{ title: string; visibility: string }>
): Promise<void> {
  const newSegment = sceneSummary?.trim() || fallbackSummaryFromSceneText(sceneText)

  // Publicly-visible timeline events the AI named this scene — real,
  // complete headlines it wrote to mark a notable beat, not sentence
  // fragments matched by a fixed keyword list.
  const newHighlights = (timelineEvents || [])
    .filter(e => e.visibility !== 'GM_ONLY' && e.title?.trim())
    .map(e => e.title.trim())

  const existing = await prisma.campaignLog.findFirst({
    where: { campaignId, sceneId, entryType: 'scene' }
  })

  if (existing) {
    const mergedHighlights = Array.from(new Set([...existing.highlights, ...newHighlights]))
      .slice(0, MAX_HIGHLIGHTS_PER_SCENE)

    await prisma.campaignLog.update({
      where: { id: existing.id },
      data: {
        turnNumber,
        summary: appendSummarySegment(existing.summary, newSegment),
        highlights: mergedHighlights
      }
    })
    return
  }

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
      summary: newSegment,
      highlights: newHighlights.slice(0, MAX_HIGHLIGHTS_PER_SCENE),
      entryType: 'scene'
    }
  })

  // Only a genuinely new scene entry (not an update extending an ongoing
  // one) advances the count a milestone is measured against - best-effort,
  // never allowed to affect the real log entry just created above.
  const sceneLogCount = await prisma.campaignLog.count({
    where: { campaignId, entryType: 'scene' }
  })
  await checkAndCreateMilestone(campaignId, sceneLogCount, turnNumber)
}

/**
 * Whether this exchange is a scene's first (no prior resolution text
 * banked yet) — gates map (re)generation to once per scene rather than
 * once per exchange (see the 7.5 map-generation step above). Pure and
 * exported so it's unit-testable without mocking the whole resolution
 * pipeline.
 */
export function isFirstSceneExchange(existingResolutions: unknown[]): boolean {
  return existingResolutions.length === 0
}

/**
 * Last-resort summary when the AI didn't report scene_summary (only
 * happens on a repaired/degraded response) — a real summary beats
 * nothing, but this is a truncation, not a summary, so it's the fallback
 * and never the primary path.
 */
export function fallbackSummaryFromSceneText(sceneText: string): string {
  const sentences = sceneText.match(/[^.!?]+[.!?]+/g) || []
  // Each match keeps its leading whitespace from the source text (the
  // regex only excludes .!?), so join on trimmed fragments rather than
  // raw ones to avoid double spaces between sentences.
  const summary = sentences.slice(0, 3).map(s => s.trim()).join(' ')
  if (summary) return summary
  return sceneText.slice(0, 300) + (sceneText.length > 300 ? '...' : '')
}

/**
 * Calculate new in-game date from an already-clamped total hour count (see
 * elapsedInGameHours in tick/pacing.ts — this never receives raw AI input).
 * Handles simple date formats like "Day X" or more complex dates.
 */
function calculateNewDate(currentDate: string, hoursToAdd: number): string {
  // Handle "Day X" format
  const dayMatch = currentDate.match(/Day (\d+)/)
  if (dayMatch) {
    const currentDay = parseInt(dayMatch[1])
    const totalDays = currentDay + Math.floor(hoursToAdd / 24)
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
    const currentMinute = parseInt(dayTimeMatch[3])

    const totalHours = parseInt(dayTimeMatch[2]) + hoursToAdd
    const newDay = currentDay + Math.floor(totalHours / 24)
    const newHour = totalHours % 24

    return `Day ${newDay}, ${newHour.toString().padStart(2, '0')}:${currentMinute.toString().padStart(2, '0')}`
  }

  // Fallback: just append time passage description
  if (hoursToAdd >= 24 && hoursToAdd % 24 === 0) {
    return `${currentDate} + ${hoursToAdd / 24} days`
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
  // Get existing NPCs and Factions from database. Fog of war: only
  // discovered ones get a wiki entry — the wiki is readable by every
  // campaign member (not just admins), so syncing an undiscovered entity
  // here would leak its existence regardless of what the AI's own prompt
  // filtering already does.
  const [npcs, factions] = await Promise.all([
    prisma.nPC.findMany({ where: { campaignId, isDiscovered: true } }),
    prisma.faction.findMany({
      where: { campaignId, isDiscovered: true },
      include: { territories: { where: { isDiscovered: true } } },
    })
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
      const baseDescription = faction.description || `${faction.name} is a group or organization in the world.`
      const territoryLine = faction.territories.length > 0
        ? `Controls: ${faction.territories.map((t) => t.name).join(', ')}`
        : null
      await prisma.wikiEntry.create({
        data: {
          campaignId,
          entryType: 'FACTION',
          name: faction.name,
          summary: faction.description || `A faction in the campaign`,
          description: [baseDescription, territoryLine].filter(Boolean).join('\n\n'),
          tags: [],
          aliases: [],
          importance: 'normal',
          lastSeenTurn: turnNumber,
          createdBy: 'ai'
        }
      })
    }
  }

  // Update clock entries. Fog of war: hidden clocks get no wiki entry — the
  // wiki is readable by every campaign member, and a GM-hidden clock's name/
  // description/exact progress leaking there would defeat isHidden entirely
  // (the wiki route's read-side filter deliberately passes CLOCK entries
  // through, on the assumption this write-side gate exists).
  const clocks = await prisma.clock.findMany({ where: { campaignId, isHidden: false } })
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

  // Sync Location records to wiki entries
  const locations = await prisma.location.findMany({
    where: { campaignId, isDiscovered: true },
    include: { ownerFaction: true },
  })
  for (const location of locations) {
    const existing = await prisma.wikiEntry.findFirst({
      where: { campaignId, entryType: 'LOCATION', name: location.name }
    })

    const locDesc = [
      location.description,
      location.locationType ? `Type: ${location.locationType}` : null,
      // Fog of war: only name the controlling faction if that faction is
      // itself discovered — territory shouldn't out a hidden faction's
      // existence any more than the AI's own prompt is allowed to.
      location.ownerFaction?.isDiscovered ? `Controlled by: ${location.ownerFaction.name}` : null,
    ].filter(Boolean).join('\n\n') || `${location.name} is a location in the world.`

    if (existing) {
      await prisma.wikiEntry.update({
        where: { id: existing.id },
        data: { description: locDesc, lastSeenTurn: turnNumber, updatedAt: new Date() }
      })
    } else {
      await prisma.wikiEntry.create({
        data: {
          campaignId,
          entryType: 'LOCATION',
          name: location.name,
          summary: location.description || `A location in the world`,
          description: locDesc,
          tags: location.locationType ? [location.locationType] : [],
          aliases: [],
          importance: 'normal',
          lastSeenTurn: turnNumber,
          createdBy: 'ai'
        }
      })
    }
  }

  // Sync Quest records to wiki entries. Quests are inherently
  // player-visible (they were given to the party on-screen), so no
  // discovery gate — description regenerated each sync like clocks.
  const quests = await prisma.quest.findMany({ where: { campaignId } })
  for (const quest of quests) {
    const existing = await prisma.wikiEntry.findFirst({
      where: { campaignId, entryType: 'QUEST', name: quest.name }
    })

    const statusLine = quest.status === 'ACTIVE' ? 'In progress' : quest.status.charAt(0) + quest.status.slice(1).toLowerCase()
    const questDesc = [
      quest.description,
      quest.objective ? `Objective: ${quest.objective}` : null,
      quest.givenBy ? `Given by: ${quest.givenBy}` : null,
      quest.reward ? `Reward: ${quest.reward}` : null,
      `Status: ${statusLine}`,
      quest.progressLog ? `Progress:\n${quest.progressLog}` : null,
    ].filter(Boolean).join('\n\n')

    if (existing) {
      await prisma.wikiEntry.update({
        where: { id: existing.id },
        data: {
          description: questDesc,
          isActive: quest.status === 'ACTIVE',
          lastSeenTurn: turnNumber,
          updatedAt: new Date()
        }
      })
    } else {
      await prisma.wikiEntry.create({
        data: {
          campaignId,
          entryType: 'QUEST',
          name: quest.name,
          summary: quest.objective || quest.description,
          description: questDesc,
          tags: [quest.status.toLowerCase()],
          aliases: [],
          importance: 'major',
          lastSeenTurn: turnNumber,
          createdBy: 'ai'
        }
      })
    }
  }

  // Sync the party's items to wiki entries — aggregated across every
  // living character's inventory (there is no Item table; see
  // lib/game/itemRegistry.ts). Entries for items the party no longer
  // carries are left in place as a record, like every other entry type.
  const inventoryCharacters = await prisma.character.findMany({
    where: { campaignId, isAlive: true },
    select: { name: true, inventory: true }
  })
  const aggregatedItems = aggregateInventoryItems(inventoryCharacters)
  for (const item of aggregatedItems) {
    const existing = await prisma.wikiEntry.findFirst({
      where: { campaignId, entryType: 'ITEM', name: item.name }
    })
    const itemDesc = describeAggregatedItem(item)

    if (existing) {
      await prisma.wikiEntry.update({
        where: { id: existing.id },
        data: { description: itemDesc, lastSeenTurn: turnNumber, updatedAt: new Date() }
      })
    } else {
      await prisma.wikiEntry.create({
        data: {
          campaignId,
          entryType: 'ITEM',
          name: item.name,
          summary: itemDesc.split('\n')[0],
          description: itemDesc,
          tags: item.tags,
          aliases: [],
          importance: 'normal',
          lastSeenTurn: turnNumber,
          createdBy: 'ai'
        }
      })
    }
  }
}
