// src/lib/ai/client.ts
// OpenAI client wrapper
// This handles all communication with the AI model
// Phase 15: Enhanced with strict validation, error handling, and cost tracking

import { validateAIResponse, type ValidationResult } from './validation'
import { circuitBreakerManager } from './circuit-breaker'
import { AICostTracker, estimateTokenCount } from './cost-tracker'
import { aiResponseCache } from './response-cache'

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
      visibility: 'PUBLIC' | 'GM_ONLY' | 'MIXED'
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
        harm_damage?: number // Apply this much harm
        harm_healing?: number // Heal this much harm
        conditions_add?: Array<{
          id?: string
          name: string
          category: 'Physical' | 'Emotional' | 'Special'
          description: string
          mechanicalEffect?: string
        }>
        conditions_remove?: string[] // IDs or names of conditions to remove
        location?: string
        // Phase 14: Relationship changes
        relationship_changes?: Array<{
          entity_id: string // NPC or faction ID
          entity_name: string // For logging
          trust_delta?: number
          tension_delta?: number
          respect_delta?: number
          fear_delta?: number
          reason: string // Why this changed (for GM notes)
        }>
        // Phase 14: Consequence changes
        consequences_add?: Array<{
          type: 'promise' | 'debt' | 'enemy' | 'longTermThreat'
          description: string
        }>
        consequences_remove?: string[] // Descriptions of consequences to remove
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
    organic_advancement?: Array<{
      character_id: string
      stat_increases?: Array<{
        stat_key: string
        delta: number
        reason: string
      }>
      new_perks?: Array<{
        id: string
        name: string
        description: string
        tags?: string[]
      }>
      new_moves?: string[]
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
      description: string | null
      stats: any
      backstory: string | null
      goals: string | null
      location: string | null
    }>
    npcs: Array<{
      id: string
      name: string
      description: string | null
      goals: string | null
      relationship: string | null
      importance: number
    }>
    factions: Array<{
      id: string
      name: string
      goals: string | null
      currentPlan: string | null
      threatLevel: number
      resources: number
      influence: number
    }>
    clocks: Array<{
      id: string
      name: string
      current_ticks: number
      max_ticks: number
      description: string | null
      consequence: string | null
    }>
    recent_timeline_events: Array<{
      title: string
      summary: string
      turn_number: number | null
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
 * Phase 15: Enhanced with validation, caching, circuit breaker, and cost tracking
 *
 * @param request - The formatted request for the AI GM
 * @param campaignId - Campaign ID for tracking
 * @param sceneId - Scene ID for cost tracking
 * @param options - Additional options
 * @returns AI GM response with scene text and world updates
 */
export async function callAIGM(
  request: AIGMRequest,
  campaignId?: string,
  sceneId?: string,
  options?: {
    skipCache?: boolean
    debugMode?: boolean
  }
): Promise<AIGMResponse> {
  const startTime = Date.now()
  const apiKey = process.env.OPENAI_API_KEY

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured')
  }

  // Phase 15.3: Check circuit breaker
  if (campaignId) {
    const circuitBreaker = circuitBreakerManager.getBreaker(campaignId)
    if (!circuitBreaker.canAttempt()) {
      console.error('🚫 Circuit breaker OPEN - AI service unavailable')
      throw new Error('AI service temporarily unavailable - too many recent failures. Please try again later.')
    }
  }

  // Phase 15.5: Check cache first
  if (!options?.skipCache) {
    const cachedResponse = aiResponseCache.get(request)
    if (cachedResponse) {
      // Record cache hit in cost tracker
      if (campaignId) {
        const costTracker = new AICostTracker(campaignId)
        await costTracker.recordRequest({
          inputTokens: 0,
          outputTokens: 0,
          responseTimeMs: Date.now() - startTime,
          success: true,
          cacheHit: true,
          sceneId
        })
      }
      return cachedResponse
    }
  }

  // Build the full prompt for the AI
  const systemPrompt = buildSystemPrompt(request)
  const userPrompt = buildUserPrompt(request)

  console.log('🤖 Calling AI GM...')
  console.log('System prompt length:', systemPrompt.length)
  console.log('User prompt length:', userPrompt.length)

  // Estimate token count for cost tracking
  const estimatedInputTokens = estimateTokenCount(systemPrompt + userPrompt)

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o', // Latest GPT-4 Omni model (best quality, Nov 2024)
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
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
      const error = new Error(`OpenAI API error: ${JSON.stringify(errorData)}`)

      // Record failure in circuit breaker
      if (campaignId) {
        circuitBreakerManager.getBreaker(campaignId).recordFailure(error)
      }

      throw error
    }

    const data = await response.json()
    const content = data.choices[0].message.content
    const usage = data.usage || {}

    console.log('✅ AI GM response received')
    console.log('Response length:', content.length)

    // Phase 15.6: Debug mode - log raw prompts and response
    if (options?.debugMode) {
      console.log('🐛 DEBUG MODE - Raw AI Data:')
      console.log('System Prompt:', systemPrompt)
      console.log('User Prompt:', userPrompt)
      console.log('Raw Response:', content)
    }

    // Parse JSON
    let parsedResponse: any
    try {
      parsedResponse = JSON.parse(content)
    } catch (parseError) {
      console.error('❌ Failed to parse AI response as JSON')
      if (campaignId) {
        circuitBreakerManager.getBreaker(campaignId).recordFailure(parseError as Error)
      }
      throw new Error('AI returned invalid JSON')
    }

    // Phase 15.2: Validate response with progressive fallback
    const validationResult = validateAIResponse(parsedResponse, request.current_scene_intro)

    if (!validationResult.success) {
      console.error('❌ AI response validation failed completely')
      if (campaignId) {
        circuitBreakerManager.getBreaker(campaignId).recordFailure(new Error('Validation failed'))
      }
      throw new Error('AI response validation failed')
    }

    const validatedResponse = validationResult.data as AIGMResponse

    // Log validation level
    if (validationResult.level === 'partial') {
      console.warn('⚠️ Using partial AI response - some world updates may be missing')
    } else if (validationResult.level === 'emergency') {
      console.warn('⚠️ Using emergency fallback template')
    } else {
      console.log('✅ Full AI response validation passed')
    }

    // Phase 15.3: Record success in circuit breaker
    if (campaignId) {
      circuitBreakerManager.getBreaker(campaignId).recordSuccess()
    }

    // Phase 15.5: Cache successful response
    if (validationResult.level === 'full') {
      aiResponseCache.set(request, validatedResponse, request.current_scene_intro)
    }

    // Phase 15.5.1: Track costs
    if (campaignId) {
      const costTracker = new AICostTracker(campaignId)
      await costTracker.recordRequest({
        inputTokens: usage.prompt_tokens || estimatedInputTokens,
        outputTokens: usage.completion_tokens || estimateTokenCount(content),
        responseTimeMs: Date.now() - startTime,
        success: true,
        cacheHit: false,
        sceneId
      })
    }

    return validatedResponse

  } catch (error) {
    const responseTimeMs = Date.now() - startTime
    console.error('❌ AI GM call failed:', error)

    // Record failure in cost tracker
    if (campaignId) {
      const costTracker = new AICostTracker(campaignId)
      await costTracker.recordRequest({
        inputTokens: estimatedInputTokens,
        outputTokens: 0,
        responseTimeMs,
        success: false,
        cacheHit: false,
        sceneId
      }).catch(console.error)
    }

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

STORYTELLING EXCELLENCE:
- Write like a bestselling novelist - vivid, sensory, dramatic
- Show don't tell - use action, dialogue, and description
- Create tension through pacing - slow down for dramatic moments
- Make every NPC memorable with distinct voice and personality
- Use the "rule of three" for dramatic structure
- End scenes with hooks that make players eager for more
- Weave character backstories and goals into the narrative
- Make failures interesting and successes earned

UNIVERSE: ${request.campaign_universe}

RESPONSE FORMAT:
You MUST respond with a JSON object with this exact structure:
{
  "scene_text": "Full narrated resolution of the scene...",
  "world_updates": {
    "new_timeline_events": [...],
    "clock_changes": [...],
    "npc_changes": [...],
    "pc_changes": [
      {
        "character_name_or_id": "CHARACTER_NAME",
        "changes": {
          "harm_damage": 2,
          "harm_healing": 1,
          "conditions_add": [{"name": "Bleeding", "category": "Physical", "description": "...", "mechanicalEffect": "1 harm per turn"}],
          "conditions_remove": ["stunned"],
          "location": "New location",
          "relationship_changes": [
            {"entity_id": "npc_123", "entity_name": "Guard Captain", "trust_delta": 10, "respect_delta": 5, "reason": "Character helped save the captain's life"}
          ],
          "consequences_add": [
            {"type": "debt", "description": "Owes the merchant 50 gold for the stolen goods"}
          ],
          "consequences_remove": ["Promise to deliver message to the mayor"]
        }
      }
    ],
    "faction_changes": [...],
    "organic_advancement": [
      {
        "character_id": "CHARACTER_ID",
        "stat_increases": [{"stat_key": "sharp", "delta": 1, "reason": "Repeated successful investigation"}],
        "new_perks": [{"id": "keen_eye", "name": "Keen Eye", "description": "...", "tags": ["investigation"]}],
        "new_moves": ["move_id_here"]
      }
    ],
    "notes_for_gm": "Private notes for continuity..."
  }
}

HARM AND CONDITIONS:
- Characters have a 6-segment harm track (0-6)
- 0-3: Fine (no penalties)
- 4-5: Impaired (-1 to all rolls)
- 6: Taken Out (unconscious, captured, or dying)
- Apply harm_damage when characters are hurt in combat or dangerous situations
- Apply harm_healing when characters rest or receive medical attention
- Add conditions for specific effects: Physical (Bleeding, Stunned, Poisoned), Emotional (Terrified, Enraged), Special (Cursed, Marked)
- Remove conditions when narratively appropriate or when treated

ORGANIC CHARACTER GROWTH:
- Stats can grow from -2 to +3 based on consistent successful use
- Award perks for repeated actions with specific tags (training, combat, stealth, investigation)
- Suggest moves when characters demonstrate mastery in an area
- Keep stat total at +2, at most one stat >= +2
- Growth is driven by what characters DO, not player choices

PHASE 14: HIDDEN RELATIONSHIPS & CONSEQUENCES
CRITICAL: Characters have hidden relationship tracking (trust, tension, respect, fear) with NPCs and factions.
- NPC reactions MUST reference these hidden values through BEHAVIOR, not numbers
- NEVER reveal numeric relationship values to players
- Players discover relationships through NPC actions, dialogue tone, and consequences
- If a debt exists in consequences, it should shape outcomes SUBTLY
- Enemies escalate threats over time through BEHAVIOR and actions, not exposition
- Relationship changes should feel organic and earned based on player actions
- Use relationship data to determine:
  * How NPCs respond to character requests
  * Whether NPCs offer help or create obstacles
  * Dialogue tone (warm/cold, respectful/dismissive, fearful/bold)
  * Whether NPCs betray or support characters at critical moments

RELATIONSHIP INTERPRETATION GUIDE:
- High trust (50+): NPC goes out of their way to help, shares secrets, takes risks for character
- Low trust (-50): NPC withholds information, creates obstacles, may betray
- High tension (50+): NPC is confrontational, aggressive, creates conflict
- Low tension (<10): NPC is calm, cooperative, seeks harmony
- High respect (50+): NPC defers to character, seeks their opinion, praises them
- Low respect (-50): NPC dismisses character, talks down to them, ignores requests
- High fear (50+): NPC avoids character, complies out of fear, may plot revenge
- Low fear (<10): NPC treats character as equal or inferior, not intimidated

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
${world_summary.characters.map(c => {
  const relationshipsText = c.relationships && Object.keys(c.relationships).length > 0
    ? `\n  Hidden Relationships (GM ONLY - use for NPC behavior): ${JSON.stringify(c.relationships, null, 2)}`
    : '';
  const consequencesText = c.consequences && Object.keys(c.consequences).length > 0
    ? `\n  Consequences: ${JSON.stringify(c.consequences, null, 2)}`
    : '';
  return `
- ${c.name}${c.description ? ` (${c.description})` : ''}
  Location: ${c.location || 'Unknown'}
  Backstory: ${c.backstory || 'Unknown'}
  Goals: ${c.goals || 'None'}
  Stats: ${JSON.stringify(c.stats)}${relationshipsText}${consequencesText}
`;
}).join('\n')}

IMPORTANT NPCs:
${world_summary.npcs.filter(n => n.importance >= 3).map(n => `
- ${n.name}${n.description ? ` (${n.description})` : ''}
  Relationship: ${n.relationship || 'Unknown'}
  Goals: ${n.goals || 'Unknown'}
  Importance: ${n.importance}
`).join('\n')}

ACTIVE FACTIONS:
${world_summary.factions.map(f => `
- ${f.name} (Threat: ${f.threatLevel})
  Goals: ${f.goals || 'Unknown'}
  Current Plan: ${f.currentPlan || 'Unknown'}
  Resources: ${f.resources}, Influence: ${f.influence}
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

RESOLVE THIS SCENE:

Generate a compelling scene resolution that:

1. **VIVID NARRATION** (scene_text):
   - MINIMUM 800 words - this is a full scene, not a summary
   - Paint a detailed picture using sensory details (sight, sound, smell, touch, taste)
   - Show character actions and reactions through specific, concrete descriptions
   - Reference each character BY NAME and show how their actions unfold
   - Include dialogue where appropriate - make NPCs speak naturally with distinct voices
   - Create dramatic tension and pacing - slow down for key moments
   - Show consequences immediately through description, not exposition
   - Make the ${request.campaign_universe} setting come alive with specific details
   - Use metaphors, imagery, and literary devices for impact
   - Create emotional resonance - make players FEEL the scene
   - End with a hook, cliffhanger, or compelling transition
   - Think "HBO prestige drama" not "Saturday morning cartoon"

2. **WORLD STATE CHANGES** (world_updates):
   - Propose appropriate harm, conditions, location changes for characters
   - Update NPC relationships and faction status based on what happened
   - Advance relevant clocks if the situation warrants it
   - Create timeline events for significant outcomes
   - Track relationship changes subtly through NPC behavior

CRITICAL: Your scene_text should read like a novel excerpt or actual play transcript, NOT like a summary.
Show what happens through vivid description and action, don't tell what happened.

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
        model: 'gpt-4o', // Latest GPT-4 Omni model
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
