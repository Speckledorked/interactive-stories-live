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
    in_game_date: worldMeta.currentInGameDate || 'Day 1',

    characters: characters.map(c => ({
      id: c.id,
      name: c.name,
      description: c.description,
      stats: c.stats,
      backstory: c.backstory,
      goals: c.goals,
      location: c.currentLocation,
      harm: c.harm,
      conditions: c.conditions,
      moves: c.moves,
      experience: c.experience,
      statUsage: c.statUsage,
      perks: c.perks,
      inventory: c.inventory,
      equipment: c.equipment,
      resources: c.resources,
      relationships: c.relationships,
      consequences: c.consequences
    })),

    npcs: npcs.map(n => ({
      id: n.id,
      name: n.name,
      description: n.description,
      goals: n.goals,
      relationship: n.relationship,
      importance: n.importance
    })),

    factions: factions.map(f => ({
      id: f.id,
      name: f.name,
      goals: f.goals,
      currentPlan: f.currentPlan,
      threatLevel: f.threatLevel,
      resources: f.resources,
      influence: f.influence
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
      summary: e.summaryPublic || e.summaryGM || 'No summary available',
      turn_number: e.turnNumber
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
    campaign_universe: campaign.universe || 'Generic Fantasy',
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
    where: { id: campaignId },
    include: {
      characters: {
        where: { isAlive: true },
        select: {
          name: true,
          pronouns: true,
          description: true,
          goals: true,
          backstory: true
        }
      }
    }
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

  // Build character context
  const characterContext = campaign.characters.length > 0
    ? `\n\nPLAYER CHARACTERS:
${campaign.characters.map(c => `- ${c.name} (${c.pronouns || 'they/them'}): ${c.description || 'A mysterious adventurer'}
  Goals: ${c.goals || 'To be determined'}
  Background: ${c.backstory || 'Unknown'}`).join('\n')}`
    : '\n\nNo player characters have been created yet.'

  const prompt = `You are the Game Master for a ${campaign.universe} campaign.

${campaign.aiSystemPrompt}

WORLD STATE:
${JSON.stringify(worldSummary, null, 2)}
${characterContext}

LAST SCENE RESOLUTION:
${lastScene?.sceneResolutionText || 'This is the first scene of the campaign.'}

Generate a compelling, dynamic scene introduction that:
1. Directly involves the player characters by name and references their goals or backstories
2. Creates IMMEDIATE stakes and tension - what's at risk right now?
3. Provides vivid, immersive sensory details specific to the ${campaign.universe} setting
4. Presents a clear dramatic question or choice the characters must face
5. Sets the tone and atmosphere appropriate to the universe
6. Advances active faction plans or clocks where appropriate
7. Is 2-4 paragraphs long and ends with a clear moment of decision or action

For the first scene of a campaign:
- Start with action or a compelling hook, not generic descriptions
- Establish the world through specific details, not exposition
- Create an immediate situation that demands character response

Write ONLY the scene introduction text. Do not include JSON, meta-commentary, or any other formatting.`

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

    // Fallback scene intro if AI fails - include character names if available
    const characterNames = campaign.characters.map(c => c.name).join(', ')
    const fallbackIntro = characterNames
      ? `${characterNames} find themselves at a crossroads in the ${campaign.universe}. The path ahead is shrouded in uncertainty, but action is required. What will ${campaign.characters.length > 1 ? 'they' : characterNames} do?`
      : `The story begins in the ${campaign.universe}. Danger and opportunity await in equal measure. What will you do?`

    return fallbackIntro
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
