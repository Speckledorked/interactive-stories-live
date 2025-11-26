// src/lib/ai/worldState.ts
// Convert database records into a clean format for the AI GM

import { prisma } from '@/lib/prisma'
import { AIGMRequest } from './client'
import { ComplexExchangeResolver, NarrativeFlowManager } from '@/lib/game/complex-exchange-resolver' // Phase 16
import { buildOptimizedContext } from './contextManager' // Phase 14.6: Context optimization
import { retrieveRelevantHistory } from './memoryRetrieval' // Campaign Memory RAG

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

  // Build complete scene context including previous resolutions
  // This ensures the AI sees what already happened in the scene
  let sceneContext = scene.sceneIntroText
  if (scene.sceneResolutionText) {
    // OPTIMIZATION: Only include the last 2 exchanges to prevent prompt bloat
    // Split by the separator used when appending resolutions
    const allResolutions = scene.sceneResolutionText.split('\n\n---\n\n')
    const recentResolutions = allResolutions.slice(-2) // Last 2 exchanges only

    if (recentResolutions.length > 0) {
      sceneContext += '\n\n## What Has Happened Recently:\n\n' + recentResolutions.join('\n\n---\n\n')
    }
  }

  // RAG Memory Retrieval: Get relevant campaign history
  let relevantMemories: any[] = []
  try {
    console.log('🧠 Retrieving relevant campaign memories...')

    // Get NPCs and factions from world summary for filtering
    const npcs = await prisma.nPC.findMany({ where: { campaignId } })
    const factions = await prisma.faction.findMany({ where: { campaignId } })
    const characters = await prisma.character.findMany({
      where: { campaignId, isAlive: true }
    })

    relevantMemories = await retrieveRelevantHistory(
      campaignId,
      {
        currentScene: scene,
        playerActions: scene.playerActions,
        characters,
        npcs,
        factions,
      },
      {
        maxMemories: 10,
        recencyBias: 0.3, // 30% weight to recent events, 70% to semantic similarity
        minSimilarity: 0.7, // Only include memories with 70%+ relevance
        importanceBoost: true, // Boost CRITICAL and MAJOR memories
      }
    )

    console.log(`✅ Retrieved ${relevantMemories.length} relevant memories`)
  } catch (memoryError) {
    console.error('⚠️ Memory retrieval failed (non-critical):', memoryError)
    // Continue without memories - don't block scene resolution
  }

  // Add memories to world summary
  const worldSummaryWithMemories = {
    ...worldSummary,
    relevant_campaign_history: relevantMemories.map(m => ({
      turn: m.turnNumber,
      title: m.title,
      summary: m.summary,
      type: m.memoryType,
      importance: m.importance,
      emotional_tone: m.emotionalTone,
      relevance: Math.round(m.similarity * 100) + '%',
    })),
  }

  // Enhance system prompt with memory instructions
  const enhancedSystemPrompt = enhanceSystemPromptWithMemory(
    campaign.aiSystemPrompt,
    relevantMemories.length > 0
  )

  return {
    campaign_universe: campaign.universe || 'Generic Fantasy',
    ai_system_prompt: enhancedSystemPrompt + (fullGuidance ? `\n\n${fullGuidance}` : ''),
    world_summary: worldSummaryWithMemories,
    current_scene_intro: sceneContext,
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

  // Get the last scene for context (could be RESOLVED or AWAITING_ACTIONS with resolutions)
  const lastScene = await prisma.scene.findFirst({
    where: {
      campaignId,
      OR: [
        { status: 'RESOLVED' },
        { sceneResolutionText: { not: null } }
      ]
    },
    orderBy: { sceneNumber: 'desc' }
  })

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not configured')
  }

  // Build focused character context - emphasize hooks, not stats
  const characterContext = campaign.characters.length > 0
    ? `\n\nPLAYER CHARACTERS:\n${campaign.characters.map(c => {
      const parts = [
        `\n## ${c.name}`,
        `Concept: ${c.description || 'A mysterious adventurer'}`,
      ]

      // Only include the most story-relevant details
      if (c.backstory && c.backstory.length > 20) {
        parts.push(`Background hint: ${c.backstory.substring(0, 80)}${c.backstory.length > 80 ? '...' : ''}`)
      }

      if (c.goals) {
        parts.push(`Current drive: ${c.goals}`)
      }

      // Location is important for scene setting
      if (c.currentLocation) {
        parts.push(`Location: ${c.currentLocation}`)
      }

      // Only mention significant equipment or consequences
      if (c.equipment) {
        const eq = c.equipment as any
        if (eq.weapon) parts.push(`Notable: ${eq.weapon.name || eq.weapon}`)
      }

      if (c.consequences) {
        const cons = c.consequences as any
        if (cons.enemies && cons.enemies.length > 0) {
          parts.push(`Threat: ${cons.enemies[0]}`) // Just the first enemy
        }
        if (cons.debts && cons.debts.length > 0) {
          parts.push(`Complication: ${cons.debts[0]}`) // Just the first debt
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

Generate an engaging, atmospheric scene introduction that:

**TONE & STYLE:**
- Start with ACTION or ATMOSPHERE, not character introductions
- Show, don't tell - use vivid sensory details
- Create IMMEDIATE tension or intrigue
- Be subtle - weave in character details naturally, don't list them
- Match the tone of ${campaign.universe}

**WHAT TO INCLUDE:**
- A specific, compelling situation already in progress
- Clear stakes - something matters RIGHT NOW
- Hints at the character's background/goals through context, not exposition
- A dramatic question or choice that demands action
- 2-3 paragraphs maximum

**WHAT TO AVOID:**
- Generic openings ("The heroes gather...", "Times are uncertain...")
- Character introductions or descriptions
- Listing equipment, stats, or inventory
- Explaining backstories or goals directly
- Long exposition dumps
- "Your character feels/thinks/remembers" - stay external and immersive

**APPROACH:**
If they have a location, start there mid-scene. If they have enemies, maybe hint at danger. If they have goals, drop them into a situation that challenges those goals. But do it all through ATMOSPHERE and ACTION, not explanation.

Example: Instead of "You check your sword as you remember your oath of vengeance," write "The blade catches firelight from the distant campfires. Three days of tracking, and finally, smoke on the horizon."

Write ONLY the scene introduction. No JSON, no meta-commentary, no character sheets.`

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
          { role: 'system', content: 'You are an evocative, atmospheric storyteller and game master. You show, don\'t tell. You create tension through imagery and implication, not explanation.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.9, // Higher creativity for more varied, atmospheric openings
        max_tokens: 600 // Shorter, punchier scenes (2-3 paragraphs)
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

/**
 * Enhance system prompt with campaign memory instructions
 *
 * Adds guidance to the AI about how to use retrieved campaign history
 * for maintaining long-form continuity.
 *
 * @param basePrompt - Original system prompt
 * @param hasMemories - Whether memories were retrieved
 * @returns Enhanced system prompt with memory guidance
 */
function enhanceSystemPromptWithMemory(basePrompt: string, hasMemories: boolean): string {
  if (!hasMemories) {
    // No memories retrieved, return original prompt
    return basePrompt
  }

  const memoryGuidance = `

CAMPAIGN MEMORY & LONG-FORM CONTINUITY:
You have access to semantically retrieved campaign history in the 'relevant_campaign_history'
section of the world summary. These memories are automatically selected based on relevance to
the current scene.

USE THESE MEMORIES TO:
- **Reference past events** when NPCs or factions appear ("Remember when...")
- **Maintain character arc continuity** across dozens of scenes
- **Honor promises, debts, and consequences** from earlier scenes
- **Create callbacks** to important moments (even from Scene 1!)
- **Build on established relationships** and conflicts
- **Track long-running threats** and faction plans

MEMORY IMPORTANCE LEVELS:
- **CRITICAL**: Campaign-defining moments that should heavily influence your responses
- **MAJOR**: Significant events that should be referenced when relevant
- **NORMAL**: Standard events to consider for continuity
- **MINOR**: Background context

The **relevance** percentage shows how related each memory is to the current scene.
Prioritize memories with:
- Higher relevance (80%+ are very related)
- Higher importance (CRITICAL > MAJOR > NORMAL > MINOR)
- Recent turn numbers when breaking ties

**IMPORTANT**: Weave memories naturally into the narrative. Don't just list them -
have NPCs reference past events, show consequences of earlier choices, and create
a sense of persistent world that remembers player actions.

Example: Instead of "You see Marcus the merchant," write "Marcus the merchant eyes
you warily, clearly still nursing a grudge from when you exposed his smuggling operation
three weeks ago (Scene 12)."
`

  return basePrompt + memoryGuidance
}
