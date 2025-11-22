// src/lib/ai/worldState.ts
// Convert database records into a clean format for the AI GM

import { prisma } from '@/lib/prisma'
import { AIGMRequest } from './client'
import { ComplexExchangeResolver, NarrativeFlowManager } from '@/lib/game/complex-exchange-resolver' // Phase 16
import { buildOptimizedContext } from './contextManager' // Phase 14.6: Context optimization

/**
 * Build optimized world summary using context manager
 * Reduces token usage for large campaigns (10+ scenes)
 *
 * @param campaignId - Campaign ID
 * @param currentSceneNumber - Current scene number
 * @returns Optimized world summary with location-based filtering
 */
async function buildOptimizedWorldSummary(
  campaignId: string,
  currentSceneNumber: number
): Promise<AIGMRequest['world_summary']> {
  console.log('🎯 Building optimized world summary with location filtering')

  // Get optimized context from context manager
  const optimizedContext = await buildOptimizedContext(prisma, campaignId, currentSceneNumber)

  // Get current data
  const [worldMeta, characters, allNpcs, allFactions, clocks] = await Promise.all([
    prisma.worldMeta.findUnique({ where: { campaignId } }),
    prisma.character.findMany({
      where: { campaignId, isAlive: true },
      include: { user: { select: { email: true } } }
    }),
    prisma.nPC.findMany({ where: { campaignId } }),
    prisma.faction.findMany({ where: { campaignId } }),
    prisma.clock.findMany({
      where: { campaignId, isHidden: false }
    })
  ])

  if (!worldMeta) {
    throw new Error('WorldMeta not found')
  }

  // Extract character locations for filtering
  const characterLocations = new Set(
    characters.map(c => c.currentLocation).filter(Boolean)
  )

  console.log('📍 Character locations:', Array.from(characterLocations))

  // Filter NPCs: only include those at character locations OR with high importance (4+)
  const relevantNpcs = allNpcs.filter(npc => {
    const isHighImportance = npc.importance >= 4
    const isNearby = characterLocations.size === 0 || // If no locations set, include all
      Array.from(characterLocations).some(loc => {
        if (!loc) return false
        return npc.description?.toLowerCase().includes(loc.toLowerCase()) ||
          npc.gmNotes?.toLowerCase().includes(loc.toLowerCase())
      })
    return isHighImportance || isNearby
  })

  // Filter factions: only include active threats (4-5/5) or those mentioned in character consequences
  const characterConsequences = characters.flatMap(c => {
    const cons = c.consequences as any
    return [
      ...(cons?.enemies || []),
      ...(cons?.debts || []),
      ...(cons?.longTermThreats || [])
    ]
  })

  const relevantFactions = allFactions.filter(faction => {
    const isActiveThreat = faction.threatLevel >= 4 // Threat level 4-5 are high/extreme threats
    const isInConsequences = characterConsequences.some(cons =>
      cons.toLowerCase().includes(faction.name.toLowerCase())
    )
    return isActiveThreat || isInConsequences
  })

  console.log(`🔍 Filtered entities: ${relevantNpcs.length}/${allNpcs.length} NPCs, ${relevantFactions.length}/${allFactions.length} factions`)

  // Build compressed timeline from optimized context
  const compressedTimeline = optimizedContext.importantMoments.map(moment => ({
    title: moment.title,
    summary: moment.summary,
    turn_number: moment.sceneNumber
  }))

  // Add campaign summary as a high-level overview if available
  let campaignSummaryText = ''
  if (optimizedContext.campaignSummary) {
    const summary = optimizedContext.campaignSummary
    campaignSummaryText = `
CAMPAIGN OVERVIEW (${summary.campaignPhase} phase, ${summary.totalScenes} scenes):
- Active Threats: ${summary.activeThreats.join(', ') || 'None'}
- Completed Goals: ${summary.completedGoals.join(', ') || 'None'}
    `.trim()
  }

  return {
    turn_number: worldMeta.currentTurnNumber,
    in_game_date: worldMeta.currentInGameDate || 'Day 1',

    // Include campaign summary in a special field (we'll handle this in the prompt)
    _campaignSummary: campaignSummaryText,

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

    // Only relevant NPCs
    npcs: relevantNpcs.map(n => ({
      id: n.id,
      name: n.name,
      description: n.description,
      goals: n.goals,
      relationship: n.relationship,
      importance: n.importance
    })),

    // Only relevant factions
    factions: relevantFactions.map(f => ({
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

    // Use compressed timeline from context manager
    recent_timeline_events: compressedTimeline
  } as any
}

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

  // Phase 14.6: Use optimized context for campaigns with 10+ scenes
  const sceneCount = await prisma.scene.count({ where: { campaignId } })
  let worldSummary: AIGMRequest['world_summary']

  if (sceneCount >= 10) {
    console.log('📉 Using optimized context (campaign has', sceneCount, 'scenes)')
    worldSummary = await buildOptimizedWorldSummary(campaignId, scene.sceneNumber)
  } else {
    console.log('📊 Using full context (campaign has', sceneCount, 'scenes)')
    worldSummary = await buildWorldSummaryForAI(campaignId)
  }

  // Format player actions
  const playerActions = scene.playerActions.map(action => ({
    character_name: action.character.name,
    character_id: action.character.id,
    action_text: action.actionText
  }))

  // Phase 16.3: Check if this is a complex exchange (>3 actions)
  let exchangeGuidance = ''
  if (scene.playerActions.length > 3) {
    console.log('🔀 Complex exchange detected - generating narrative sequence')
    const resolver = new ComplexExchangeResolver(campaignId, sceneId)
    const complexExchange = await resolver.resolveComplexExchange()

    exchangeGuidance = complexExchange.narrativeSequence

    if (complexExchange.conflicts.length > 0) {
      exchangeGuidance += '\n## ⚠️ Conflicts Require Special Attention\n\n'
      complexExchange.conflicts.forEach(conflict => {
        exchangeGuidance += `- **${conflict.type.toUpperCase()}**: ${conflict.resolution}\n`
      })
      exchangeGuidance += '\n'
    }
  }

  // Phase 16.4: Add narrative flow guidance
  const flowGuidance = NarrativeFlowManager.generateFlowGuidance(scene.playerActions)
  const specialCases = NarrativeFlowManager.detectSpecialCases(scene.playerActions)

  let additionalGuidance = flowGuidance

  if (specialCases.hasPvP) {
    additionalGuidance += '\n⚠️ **PvP DETECTED**: Handle player vs player conflict with extreme care. Ensure both players have agency.\n'
  }

  if (specialCases.hasCompetingGoals) {
    additionalGuidance += '\n⚠️ **COMPETING GOALS**: Players have different objectives. Narrate how these different approaches unfold.\n'
  }

  // Combine all guidance
  const fullGuidance = exchangeGuidance + additionalGuidance

  return {
    campaign_universe: campaign.universe || 'Generic Fantasy',
    ai_system_prompt: campaign.aiSystemPrompt + (fullGuidance ? `\n\n${fullGuidance}` : ''),
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
          appearance: true,
          personality: true,
          goals: true,
          backstory: true,
          stats: true,
          inventory: true,
          equipment: true,
          resources: true,
          currentLocation: true,
          moves: true,
          perks: true,
          relationships: true,
          consequences: true
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

  // Build comprehensive character context
  const characterContext = campaign.characters.length > 0
    ? `\n\nPLAYER CHARACTERS (use these details to personalize the opening scene):\n${campaign.characters.map(c => {
      const parts = [
        `\n## ${c.name} (${c.pronouns || 'they/them'})`,
        `Description: ${c.description || 'A mysterious adventurer'}`,
      ]

      if (c.appearance) {
        parts.push(`Appearance: ${c.appearance}`)
      }

      if (c.personality) {
        parts.push(`Personality: ${c.personality}`)
      }

      parts.push(`Background: ${c.backstory || 'Unknown'}`)
      parts.push(`Goals: ${c.goals || 'To be determined'}`)

      if (c.currentLocation) {
        parts.push(`Current Location: ${c.currentLocation}`)
      }

      if (c.stats) {
        const stats = c.stats as any
        parts.push(`Stats: ${Object.entries(stats).map(([key, val]) => `${key} ${(val as number) >= 0 ? '+' : ''}${val}`).join(', ')}`)
      }

      if (c.equipment) {
        const eq = c.equipment as any
        const items = []
        if (eq.weapon) items.push(`Weapon: ${eq.weapon.name || eq.weapon}`)
        if (eq.armor) items.push(`Armor: ${eq.armor.name || eq.armor}`)
        if (items.length > 0) parts.push(`Equipment: ${items.join(', ')}`)
      }

      if (c.inventory) {
        const inv = c.inventory as any
        if (inv.items && inv.items.length > 0) {
          const itemList = inv.items.slice(0, 5).map((item: any) =>
            typeof item === 'string' ? item : `${item.name}${item.quantity ? ` (x${item.quantity})` : ''}`
          ).join(', ')
          parts.push(`Carrying: ${itemList}${inv.items.length > 5 ? ', and more...' : ''}`)
        }
      }

      if (c.resources) {
        const res = c.resources as any
        const resourceParts = []
        if (res.gold !== undefined) resourceParts.push(`${res.gold} gold`)
        if (res.contacts && res.contacts.length > 0) resourceParts.push(`contacts: ${res.contacts.join(', ')}`)
        if (resourceParts.length > 0) parts.push(`Resources: ${resourceParts.join('; ')}`)
      }

      if (c.moves && c.moves.length > 0) {
        parts.push(`Special Moves: ${c.moves.slice(0, 3).join(', ')}${c.moves.length > 3 ? '...' : ''}`)
      }

      if (c.perks) {
        const perks = c.perks as any
        if (Array.isArray(perks) && perks.length > 0) {
          parts.push(`Abilities: ${perks.map((p: any) => p.name).slice(0, 3).join(', ')}`)
        }
      }

      if (c.consequences) {
        const cons = c.consequences as any
        if (cons.enemies && cons.enemies.length > 0) {
          parts.push(`⚠️ Enemies: ${cons.enemies.join(', ')}`)
        }
        if (cons.debts && cons.debts.length > 0) {
          parts.push(`⚠️ Debts: ${cons.debts.join(', ')}`)
        }
      }

      return parts.join('\n  ')
    }).join('\n')}`
    : '\n\nNo player characters have been created yet.'

  const prompt = `You are the Game Master for a ${campaign.universe} campaign.

${campaign.aiSystemPrompt}

WORLD STATE:
${JSON.stringify(worldSummary, null, 2)}
${characterContext}

LAST SCENE RESOLUTION:
${lastScene?.sceneResolutionText || 'This is the first scene of the campaign.'}

Generate a compelling, dynamic scene introduction that:
1. PERSONALIZE to the characters - reference their specific equipment, inventory, location, backstory, goals, and abilities
2. Creates IMMEDIATE stakes and tension - what's at risk right now?
3. Provides vivid, immersive sensory details specific to the ${campaign.universe} setting
4. Presents a clear dramatic question or choice the characters must face
5. Sets the tone and atmosphere appropriate to the universe
6. If characters have enemies, debts, or consequences listed - consider incorporating these into the opening tension
7. If characters have specific locations listed, start them there rather than a generic gathering point
8. Reference their equipment/inventory naturally (e.g., "As you check your sword..." or "The gold purse weighs heavy...")
9. Is 2-4 paragraphs long and ends with a clear moment of decision or action

CRITICAL - For the first scene of a campaign:
- DO NOT use generic openings like "The heroes gather" or "Times are uncertain"
- START with the characters already in a specific situation that relates to their backgrounds/goals
- USE their equipment, resources, and abilities to make the scene feel tailored to THEM
- REFERENCE their backstories, enemies, or debts to create personal stakes
- If they have a current location, start there; otherwise, choose a location relevant to their goals
- Establish the world through specific details that matter to THESE characters, not generic exposition

Example approach: If a character has "seeking revenge" as a goal and a sword as equipment, start with them tracking their enemy. If they have contacts listed, maybe a contact brings them urgent news. Make it SPECIFIC to who they are.

Write ONLY the scene introduction text. Do not include JSON, meta-commentary, or any other formatting.`

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini', // Cost optimization: mini model for scene intros
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
