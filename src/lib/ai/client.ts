// src/lib/ai/client.ts
// OpenAI client wrapper
// This handles all communication with the AI model

/**
 * AI GM Response Structure
 * This is what we expect back from the AI after resolving a scene
 */
export interface AIGMResponse {
  scene_text: string // The narrated resolution
  world_updates: {
    new_timeline_events?: Array<{
      title: string
      summary_public: string
      summary_gm: string
      is_offscreen: boolean
      visibility: 'public' | 'gm_only' | 'mixed'
    }>
    clock_changes?: Array<{
      clock_name_or_id: string
      delta: number // +1, +2, -1, etc.
    }>
    npc_changes?: Array<{
      npc_name_or_id: string
      changes: {
        notes_append?: string
        tags_add?: string[]
        tags_remove?: string[]
      }
    }>
    pc_changes?: Array<{
      character_name_or_id: string
      changes: {
        conditions_add?: string[]
        conditions_remove?: string[]
        location?: string
      }
    }>
    faction_changes?: Array<{
      faction_name_or_id: string
      changes: {
        current_plan?: string
        threat_level?: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME'
        resources?: Record<string, any>
        gm_notes_append?: string
      }
    }>
    notes_for_gm?: string // AI's private notes for continuity
  }
}

/**
 * AI GM Request Structure
 * This is what we send to the AI when asking it to resolve a scene
 */
export interface AIGMRequest {
  campaign_universe: string
  ai_system_prompt: string
  world_summary: {
    turn_number: number
    in_game_date: string
    characters: Array<{
      id: string
      name: string
      concept: string
      stats: any
      conditions: any
      location: string | null
    }>
    npcs: Array<{
      id: string
      name: string
      role: string
      tags: any
      notes: string
      is_important: boolean
    }>
    factions: Array<{
      id: string
      name: string
      goal: string
      current_plan: string
      threat_level: string
      resources: any
    }>
    clocks: Array<{
      id: string
      name: string
      current_ticks: number
      max_ticks: number
      description: string
      consequence: string
    }>
    recent_timeline_events: Array<{
      title: string
      summary: string
      turn_number: number
    }>
  }
  current_scene_intro: string
  player_actions: Array<{
    character_name: string
    character_id: string
    action_text: string
  }>
}

/**
 * Call the OpenAI API with a structured prompt
 * @param request - The formatted request for the AI GM
 * @returns AI GM response with scene text and world updates
 */
export async function callAIGM(request: AIGMRequest): Promise<AIGMResponse> {
  const apiKey = process.env.OPENAI_API_KEY

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured')
  }

  // Build the full prompt for the AI
  const systemPrompt = buildSystemPrompt(request)
  const userPrompt = buildUserPrompt(request)

  console.log('🤖 Calling AI GM...')
  console.log('System prompt length:', systemPrompt.length)
  console.log('User prompt length:', userPrompt.length)

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4-turbo-preview', // or 'gpt-4' or 'gpt-3.5-turbo'
        messages: [
          {
            role: 'system',
            content: systemPrompt
          },
          {
            role: 'user',
            content: userPrompt
          }
        ],
        temperature: 0.8, // Creative but not too random
        response_format: { type: 'json_object' } // Request JSON response
      })
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(`OpenAI API error: ${JSON.stringify(errorData)}`)
    }

    const data = await response.json()
    const content = data.choices[0].message.content

    console.log('✅ AI GM response received')
    console.log('Response length:', content.length)

    // Parse and validate the JSON response
    const aiResponse: AIGMResponse = JSON.parse(content)

    // Basic validation
    if (!aiResponse.scene_text) {
      throw new Error('AI response missing scene_text')
    }

    if (!aiResponse.world_updates) {
      aiResponse.world_updates = {}
    }

    return aiResponse
  } catch (error) {
    console.error('❌ AI GM call failed:', error)
    throw error
  }
}

/**
 * Build the system prompt that defines the AI GM's role
 */
function buildSystemPrompt(request: AIGMRequest): string {
  return `${request.ai_system_prompt}

CRITICAL INSTRUCTIONS:
- You are the SOLE Game Master. There is NO human GM.
- You control ALL NPCs, villains, factions, and world events.
- Players control ONLY their own characters and their actions.
- You MUST respond with valid JSON matching the required schema.
- Never break character or acknowledge you're an AI.
- Stay true to established world facts and character abilities.
- Make consequences matter and feel earned.
- Advance villain plans and background events naturally.

UNIVERSE: ${request.campaign_universe}

RESPONSE FORMAT:
You MUST respond with a JSON object with this exact structure:
{
  "scene_text": "Full narrated resolution of the scene...",
  "world_updates": {
    "new_timeline_events": [...],
    "clock_changes": [...],
    "npc_changes": [...],
    "pc_changes": [...],
    "faction_changes": [...],
    "notes_for_gm": "Private notes for continuity..."
  }
}

Be creative, dramatic, and true to the universe while maintaining game balance.`
}

/**
 * Build the user prompt with all the world context and player actions
 */
function buildUserPrompt(request: AIGMRequest): string {
  const { world_summary, current_scene_intro, player_actions } = request

  return `CURRENT WORLD STATE:

Turn Number: ${world_summary.turn_number}
In-Game Date: ${world_summary.in_game_date}

PLAYER CHARACTERS:
${world_summary.characters.map(c => `
- ${c.name} (${c.concept})
  Location: ${c.location || 'Unknown'}
  Conditions: ${JSON.stringify(c.conditions)}
  Stats: ${JSON.stringify(c.stats)}
`).join('\n')}

IMPORTANT NPCs:
${world_summary.npcs.filter(n => n.is_important).map(n => `
- ${n.name} (${n.role})
  Tags: ${JSON.stringify(n.tags)}
  Notes: ${n.notes}
`).join('\n')}

ACTIVE FACTIONS:
${world_summary.factions.map(f => `
- ${f.name} (Threat: ${f.threat_level})
  Goal: ${f.goal}
  Current Plan: ${f.current_plan}
`).join('\n')}

ACTIVE CLOCKS:
${world_summary.clocks.map(cl => `
- ${cl.name}: ${cl.current_ticks}/${cl.max_ticks} ticks
  ${cl.description}
  When complete: ${cl.consequence}
`).join('\n')}

RECENT EVENTS:
${world_summary.recent_timeline_events.map(e => `
- Turn ${e.turn_number}: ${e.title}
  ${e.summary}
`).join('\n')}

---

CURRENT SCENE:
${current_scene_intro}

PLAYER ACTIONS THIS SCENE:
${player_actions.map(a => `
- ${a.character_name}: "${a.action_text}"
`).join('\n')}

---

Based on the world state and player actions above, resolve this scene:

1. Narrate what happens (scene_text)
2. Propose world state changes (world_updates)
3. Advance relevant clocks if warranted
4. Update NPC/faction status as appropriate
5. Create timeline events for significant outcomes

Remember: Respond ONLY with valid JSON matching the required schema.`
}

/**
 * Simpler AI call for background world turns
 * This generates offscreen events when no players are involved
 */
export async function callAIForWorldTurn(
  campaignUniverse: string,
  aiSystemPrompt: string,
  worldSummary: any,
  clocksAboutToComplete: any[]
): Promise<{
  offscreen_events: Array<{
    title: string
    summary_public: string
    summary_gm: string
  }>
  gm_notes: string
}> {
  const apiKey = process.env.OPENAI_API_KEY

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured')
  }

  const systemPrompt = `${aiSystemPrompt}

You are generating OFFSCREEN events - things happening in the background while players are elsewhere.
Focus on villain plans, faction moves, and clock consequences.
Keep it brief and impactful.`

  const userPrompt = `World State Summary:
${JSON.stringify(worldSummary, null, 2)}

Clocks about to complete or recently advanced:
${JSON.stringify(clocksAboutToComplete, null, 2)}

Generate 1-3 brief offscreen events that show villains/factions making moves.

Respond with JSON:
{
  "offscreen_events": [
    {
      "title": "...",
      "summary_public": "What players might hear about...",
      "summary_gm": "Full details including villain intentions..."
    }
  ],
  "gm_notes": "Strategic notes about what's developing..."
}`

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
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.8,
        response_format: { type: 'json_object' }
      })
    })

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`)
    }

    const data = await response.json()
    return JSON.parse(data.choices[0].message.content)
  } catch (error) {
    console.error('World turn AI call failed:', error)
    // Return empty result rather than crashing
    return {
      offscreen_events: [],
      gm_notes: 'AI call failed - world turn skipped'
    }
  }
}
