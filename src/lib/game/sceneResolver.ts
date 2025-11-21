// src/lib/game/sceneResolver.ts
// Main scene resolution orchestrator
// This is the heart of the AI GM system

import { prisma } from '@/lib/prisma'
import { callAIGM } from '@/lib/ai/client'
import { buildSceneResolutionRequest } from '@/lib/ai/worldState'
import { applyWorldUpdates, summarizeWorldUpdates } from './stateUpdater'
import { SceneStatus } from '@prisma/client'
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
export async function resolveScene(campaignId: string, sceneId: string) {
  console.log('🎬 Starting scene resolution...')
  console.log(`Campaign: ${campaignId}`)
  console.log(`Scene: ${sceneId}`)

  // 1. Verify scene exists and is ready to resolve
  const scene = await prisma.scene.findUnique({
    where: { id: sceneId },
    include: { playerActions: true }
  })

  if (!scene) {
    throw new Error('Scene not found')
  }

  if (scene.status !== 'AWAITING_ACTIONS') {
    throw new Error(`Scene is not awaiting actions (status: ${scene.status})`)
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

  try {
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

    // 5. Call AI GM
    console.log('🤖 Calling AI GM...')
    const aiResponse = await callAIGM(aiRequest)

    console.log('✅ AI GM responded')
    console.log(`Scene text length: ${aiResponse.scene_text.length}`)
    console.log(`Updates: ${summarizeWorldUpdates(aiResponse)}`)

    // 6. Apply world updates to database
    console.log('💾 Applying world updates...')
    await applyWorldUpdates(campaignId, aiResponse, currentTurn)

    // 6.5. Apply organic character growth
    console.log('🌱 Processing organic character growth...')
    await applyOrganicCharacterGrowth(campaignId, sceneId, aiResponse)

    // 7. Store scene resolution and mark as resolved
    await prisma.scene.update({
      where: { id: sceneId },
      data: {
        sceneResolutionText: aiResponse.scene_text,
        status: 'RESOLVED' as SceneStatus
      }
    })

    console.log('✅ Scene marked as RESOLVED')

    // 8. Increment turn number
    await prisma.worldMeta.update({
      where: { id: worldMeta.id },
      data: {
        currentTurnNumber: currentTurn + 1
      }
    })

    console.log(`✅ Turn incremented: ${currentTurn} → ${currentTurn + 1}`)

    return {
      success: true,
      sceneText: aiResponse.scene_text,
      updates: summarizeWorldUpdates(aiResponse),
      newTurnNumber: currentTurn + 1
    }
  } catch (error) {
    console.error('❌ Scene resolution failed:', error)

    // Revert scene status so it can be retried
    await prisma.scene.update({
      where: { id: sceneId },
      data: { status: 'AWAITING_ACTIONS' as SceneStatus }
    })

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
