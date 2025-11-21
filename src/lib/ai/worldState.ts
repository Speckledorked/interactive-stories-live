// src/lib/ai/worldState.ts
// Convert database records into a clean format for the AI GM

import { prisma } from '@/lib/prisma'
import { AIGMRequest } from './client'

/**
 * Fetch and serialize all world state for a campaign
 * This creates a clean, AI-readable summary of the entire game world
 * 
 * @param campaignId - The campaign to summarize
 * @returns Formatted world state ready for AI
 */
export async function buildWorldSummaryForAI(campaignId: string): Promise<AIGMRequest['world_summary']> {
  console.log('📊 Building world summary for campaign:', campaignId)

  // Fetch all relevant data in parallel for speed
  const [
    campaign,
    worldMeta,
    characters,
    npcs,
    factions,
    clocks,
    recentEvents
  ] = await Promise.all([
    prisma.campaign.findUnique({ where: { id: campaignId } }),
    prisma.worldMeta.findUnique({ where: { campaignId } }),
    prisma.character.findMany({
      where: { campaignId, isAlive: true },
      include: { user: { select: { email: true } } }
    }),
    prisma.nPC.findMany({ where: { campaignId } }),
    prisma.faction.findMany({ where: { campaignId } }),
    prisma.clock.findMany({ 
      where: { campaignId, isHidden: false } // Only visible clocks for players
    }),
    prisma.timelineEvent.findMany({
      where: { 
        campaignId,
        visibility: { in: ['PUBLIC', 'MIXED'] } // Only events players can see
      },
      orderBy: { turnNumber: 'desc' },
      take: 10 // Last 10 events
    })
  ])

  if (!campaign || !worldMeta) {
    throw new Error('Campaign or WorldMeta not found')
  }

  // Format everything for the AI
  return {
    turn_number: worldMeta.currentTurnNumber,
    in_game_date: worldMeta.currentInGameDate || 'Unknown',
    
    characters: characters.map(c => ({
      id: c.id,
      name: c.name,
      concept: c.description || 'Unknown',
      stats: c.stats,
      conditions: {},
      location: c.currentLocation
    })),
    
    npcs: npcs.map(n => ({
      id: n.id,
      name: n.name,
      role: n.description || 'NPC',
      tags: [],
      notes: n.gmNotes || '',
      is_important: n.importance > 3
    })),
    
    factions: factions.map(f => ({
      id: f.id,
      name: f.name,
      goal: f.goals || 'Unknown',
      current_plan: f.currentPlan || '',
      threat_level: f.threatLevel.toString(),
      resources: f.resources
    })),
    
    clocks: clocks.map(cl => ({
      id: cl.id,
      name: cl.name,
      current_ticks: cl.currentTicks,
      max_ticks: cl.maxTicks,
      description: cl.description || '',
      consequence: cl.consequence || ''
    })),
    
    recent_timeline_events: recentEvents.map(e => ({
      title: e.title,
      summary: e.summaryPublic || '',
      turn_number: e.turnNumber || 0
    }))
  }
}

/**
 * Build a complete AI GM request for scene resolution
 * 
 * @param campaignId - Campaign ID
 * @param sceneId - Current scene ID
 * @returns Complete request object ready to send to AI
 */
export async function buildSceneResolutionRequest(
  campaignId: string,
  sceneId: string
): Promise<AIGMRequest> {
  console.log('🎬 Building scene resolution request')
  
  // Get campaign info
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId }
  })

  if (!campaign) {
    throw new Error('Campaign not found')
  }

  // Get current scene with all actions
  const scene = await prisma.scene.findUnique({
    where: { id: sceneId },
    include: {
      playerActions: {
        include: {
          character: true,
          user: { select: { email: true } }
        }
      }
    }
  })

  if (!scene) {
    throw new Error('Scene not found')
  }

  // Get world summary
  const worldSummary = await buildWorldSummaryForAI(campaignId)

  // Format player actions
  const playerActions = scene.playerActions.map(action => ({
    character_name: action.character.name,
    character_id: action.character.id,
    action_text: action.actionText
  }))

  return {
    campaign_universe: campaign.universe || 'Unknown',
    ai_system_prompt: campaign.aiSystemPrompt,
    world_summary: worldSummary,
    current_scene_intro: scene.sceneIntroText,
    player_actions: playerActions
  }
}

/**
 * Generate intro text for a brand new scene
 * This is called when starting a fresh scene after the previous one resolved
 * 
 * @param campaignId - Campaign ID
 * @returns AI-generated scene intro text
 */
export async function generateNewSceneIntro(campaignId: string): Promise<string> {
  console.log('🎭 Generating new scene intro')

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId }
  })

  if (!campaign) {
    throw new Error('Campaign not found')
  }

  const worldSummary = await buildWorldSummaryForAI(campaignId)

  // Get the last resolved scene for context
  const lastScene = await prisma.scene.findFirst({
    where: { campaignId, status: 'RESOLVED' },
    orderBy: { sceneNumber: 'desc' }
  })

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not configured')
  }

  const prompt = `You are the Game Master for a ${campaign.universe} campaign.

${campaign.aiSystemPrompt}

WORLD STATE:
${JSON.stringify(worldSummary, null, 2)}

LAST SCENE RESOLUTION:
${lastScene?.sceneResolutionText || 'This is the first scene of the campaign.'}

Generate a compelling scene introduction that:
1. Follows naturally from the last scene (or starts the campaign if first scene)
2. Creates tension or opportunity for the characters
3. Advances active faction plans or clocks where appropriate
4. Gives players clear opportunities to act
5. Is 2-4 paragraphs long

Write ONLY the scene introduction text. Do not include JSON or any other formatting.`

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4-turbo-preview',
        messages: [
          { role: 'system', content: 'You are a creative game master.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.9 // High creativity for scene intros
      })
    })

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`)
    }

    const data = await response.json()
    const sceneIntro = data.choices[0].message.content.trim()

    console.log('✅ Scene intro generated:', sceneIntro.substring(0, 100) + '...')

    return sceneIntro
  } catch (error) {
    console.error('❌ Scene intro generation failed:', error)
    
    // Fallback scene intro if AI fails
    return `The story continues. The heroes find themselves at a critical moment, with danger and opportunity in equal measure. What will they do?`
  }
}

/**
 * Helper: Get world state including GM-only information
 * Used for admin views and debugging
 */
export async function buildFullWorldState(campaignId: string) {
  const [
    campaign,
    worldMeta,
    characters,
    npcs,
    factions,
    allClocks, // Including hidden ones
    allEvents  // Including GM-only events
  ] = await Promise.all([
    prisma.campaign.findUnique({
      where: { id: campaignId }
    }),
    prisma.worldMeta.findUnique({ where: { campaignId } }),
    prisma.character.findMany({ 
      where: { campaignId },
      include: { user: { select: { email: true } } }
    }),
    prisma.nPC.findMany({ where: { campaignId } }),
    prisma.faction.findMany({ where: { campaignId } }),
    prisma.clock.findMany({ where: { campaignId } }),
    prisma.timelineEvent.findMany({
      where: { campaignId },
      orderBy: { turnNumber: 'desc' },
      take: 20
    })
  ])

  return {
    campaign,
    worldMeta,
    characters,
    npcs,
    factions,
    clocks: allClocks,
    timeline: allEvents
  }
}
