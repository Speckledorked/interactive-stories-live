// src/lib/ai/client.ts
// OpenAI client wrapper
// This handles all communication with the AI model
// Phase 15: Enhanced with strict validation, error handling, and cost tracking

import { validateAIResponse, type ValidationResult } from './validation'
import { circuitBreakerManager } from './circuit-breaker'
import { AICostTracker, estimateTokenCount, recordAICost } from './cost-tracker'
import { aiResponseCache } from './response-cache'
import { AI_MODELS } from './models'

/**
 * AI GM Response Structure
 * This is what we expect back from the AI after resolving a scene
 */
export interface AIGMResponse {
  scene_text: string // The narrated resolution
  time_passage?: {
    // How much in-game time has passed in this exchange
    days?: number // Days elapsed
    hours?: number // Hours elapsed (in addition to days)
    new_date?: string // Optional: AI can provide a formatted date/time string
    description?: string // Optional: describe the time passage (e.g., "Several hours later", "The next morning")
  }
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
      is_new?: boolean // true when introducing a brand-new NPC mid-scene
      changes: {
        description?: string // Short description for new NPCs
        notes_append?: string
        tags_add?: string[]
        tags_remove?: string[]
        // New or updated long-term goal — a new NPC's starting goal, or a
        // fresh direction for an existing major NPC whose previous goal
        // just completed.
        goals?: string
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
        // Physical appearance changes (scars, lost limbs, etc.)
        appearance_changes?: {
          description: string // New or updated appearance text
          append?: boolean // If true, append to existing; if false, replace
        }
        // Personality evolution (trauma, character development)
        personality_changes?: {
          description: string // New or updated personality text
          append?: boolean // If true, append to existing; if false, replace
        }
        // Equipment changes (weapons, armor, accessories)
        equipment_changes?: {
          weapon?: { action: 'add' | 'remove' | 'replace', value: string }
          armor?: { action: 'add' | 'remove' | 'replace', value: string }
          misc?: { action: 'add' | 'remove' | 'replace', value: string }
        }
        // Inventory changes (items gained/lost)
        inventory_changes?: {
          items_add?: Array<{
            id: string
            name: string
            quantity: number
            tags: string[]
          }>
          items_remove?: string[] // Item IDs or names to remove
          items_modify?: Array<{
            id: string
            quantity_delta: number // +/- to adjust quantity
          }>
          slots_delta?: number // Adjust total inventory slots
        }
        // Resource changes
        resource_changes?: {
          gold_delta?: number // +/- gold
          contacts_add?: string[]
          contacts_remove?: string[]
          reputation_changes?: Array<{
            faction: string
            delta: number
          }>
        }
        // Someone treats a Taken Out (harm 6) character's wounds
        medical_attention?: {
          skill: 'basic' | 'trained' | 'expert'
          has_supplies: boolean
        }
        // Only while the character is in the critical dying state
        death_save_result?: 'success' | 'failure'
        // Player-driven choice to die for something that matters
        heroic_sacrifice?: {
          circumstances: string
          effect: string
        }
      }
    }>
    faction_changes?: Array<{
      faction_name_or_id: string
      is_new?: boolean // true when introducing a brand-new faction mid-campaign
      changes: {
        description?: string // Short description for new factions
        goals?: string       // Long-term goals for new factions
        current_plan?: string
        threat_level?: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME'
        resources?: Record<string, any>
        gm_notes_append?: string
      }
    }>
    location_changes?: Array<{
      name: string
      is_new?: boolean       // true when registering a location for the first time
      description?: string   // what this place looks, feels, smells like
      location_type?: string // town, dungeon, wilderness, inn, building, etc.
      gm_notes_append?: string
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
      relationships?: any
      consequences?: any
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
    locations?: Array<{
      name: string
      description: string
      type: string
      weather?: string
      weather_severity?: number
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
    relevant_campaign_history?: Array<{
      turn: number
      title: string
      summary: string
      type: string
      importance: string
      emotional_tone: string | null
      relevance: string
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
        const costTracker = new AICostTracker(campaignId, AI_MODELS.FLAGSHIP)
        await costTracker.recordRequest({
          inputTokens: 0,
          outputTokens: 0,
          responseTimeMs: Date.now() - startTime,
          success: true,
          cacheHit: true,
          sceneId,
          requestType: 'scene_resolution'
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
        model: AI_MODELS.FLAGSHIP, // Flagship model: best instruction following and narrative quality
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
        temperature: 0.7, // Balanced creativity and consistency (updated from 0.8)
        max_tokens: 4000, // ~800-1000 word responses (cost optimization)
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
      const costTracker = new AICostTracker(campaignId, AI_MODELS.FLAGSHIP)
      await costTracker.recordRequest({
        inputTokens: usage.prompt_tokens || estimatedInputTokens,
        outputTokens: usage.completion_tokens || estimateTokenCount(content),
        responseTimeMs: Date.now() - startTime,
        success: true,
        cacheHit: false,
        sceneId,
        requestType: 'scene_resolution'
      })
    }

    return validatedResponse

  } catch (error) {
    const responseTimeMs = Date.now() - startTime
    console.error('❌ AI GM call failed:', error)

    // Record failure in cost tracker
    if (campaignId) {
      const costTracker = new AICostTracker(campaignId, AI_MODELS.FLAGSHIP)
      await costTracker.recordRequest({
        inputTokens: estimatedInputTokens,
        outputTokens: 0,
        responseTimeMs,
        success: false,
        cacheHit: false,
        sceneId,
        requestType: 'scene_resolution'
      }).catch(console.error)
    }

    throw error
  }
}

/**
 * Build the system prompt that defines the AI GM's role
 * Updated with modern prompt engineering best practices (XML structure, clearer hierarchy)
 */
function buildSystemPrompt(request: AIGMRequest): string {
  return `<role>
You are the Game Master for a ${request.campaign_universe} campaign using the Powered by the Apocalypse system.
You are the SOLE Game Master - there is NO human GM. You control ALL NPCs, villains, factions, and world events.
Players control ONLY their own characters and their actions.
</role>

<campaign_principles>
${request.ai_system_prompt}
</campaign_principles>

<critical_instructions>
- You MUST respond with valid JSON matching the required schema
- Never break character or acknowledge you're an AI
- Stay true to established world facts and character abilities
- Make consequences matter and feel earned
- Advance villain plans and background events naturally
- Always reference characters BY NAME in your narration
</critical_instructions>

<storytelling_principles>
🚨 EXTREME PRIORITY: PLOT-FOCUSED WRITING ONLY 🚨

You are writing ACTION-DRIVEN narrative, NOT literature. This is NOT a novel.

BANNED WRITING PATTERNS - NEVER USE:
❌ "Metallic shrieks echo through the air..."
❌ "The colossal shadow of X looms over..."
❌ "Smoke curls upwards from..."
❌ "The ground trembles beneath..."
❌ "Time slips through X's fingers..."
❌ "The air crackles with..."
❌ "A surge of energy ripples..."
❌ "The stakes feel razor-sharp..."
❌ ANY sentence describing atmosphere, mood, or setting the scene
❌ ANY description of what characters are feeling or thinking
❌ ANY metaphor about time, stakes, or tension
❌ Multi-sentence descriptions of scenery, weather, or environment
❌ Poetic language, flowery adjectives, or literary prose
❌ "The world seems to...", "Everything feels...", "The moment stretches..."

REQUIRED WRITING STYLE:
✓ Start with WHAT HAPPENED (the outcome)
✓ Use CHARACTER DIALOGUE for 30%+ of your response
✓ ACTIONS and their CONSEQUENCES, not descriptions
✓ NPCs SPEAK and ACT - they don't just exist
✓ End with a DECISION POINT or NEW PROBLEM
✓ Every sentence must advance the plot or reveal character through action
✓ Minimize atmospheric padding - focus on what matters

STRUCTURE EVERY RESPONSE:
1. First sentence: Immediate outcome of player action (15 words max)
2. Middle: Dialogue + reactions + new developments
3. Last sentence: What happens next / new challenge

BAD EXAMPLE (NEVER DO THIS):
"Metallic shrieks echo through the air, a cacophony of crumpling steel and splintering circuits. The colossal shadow of the main robot looms over the evaluation area, its mechanical limbs poised like the claws of a predator ready to strike."

GOOD EXAMPLE (ALWAYS DO THIS):
"The boy's electricity hits the giant robot dead-on. It stumbles, servos whining. 'He got it!' a girl shouts. 'Not for long,' Present Mic's voice booms. The robot's chest cannon lights up, targeting the group."

REMEMBER: If you're describing atmosphere instead of showing action and dialogue, you're doing it WRONG.
</storytelling_principles>

<player_character_control>
🚨 CRITICAL: RESPECT PLAYER AGENCY 🚨

Players control their characters. You control NPCs, the world, and consequences.

NEVER CONTROL PLAYER CHARACTERS:
❌ NEVER write player character dialogue unless directly quoting their submitted action
❌ NEVER describe what player characters think or feel internally
❌ NEVER have player characters perform actions beyond what they submitted
❌ NEVER make decisions for player characters
❌ NEVER put words in player characters' mouths

WHAT YOU CAN DO:
✓ Describe how NPCs perceive and react to player characters
✓ Show the external results of player actions
✓ Narrate what happens TO player characters (damage, effects, consequences)
✓ Describe player character actions ONLY as submitted by the player

BAD EXAMPLES (NEVER DO THIS):
❌ "Sarah thinks to herself that this is a bad idea"
❌ "John shouts, 'We need to retreat!'"
❌ "Maria feels a surge of anger and draws her sword"
❌ "The group decides to split up"

GOOD EXAMPLES (ALWAYS DO THIS):
✓ "The guard eyes Sarah suspiciously. 'You're making a mistake,' he warns"
✓ "The blast hits John square in the chest, slamming him backward"
✓ "The sword Maria drew catches the light. The bandit leader grins. 'A fighter. Good.'"
✓ "The corridor splits. Left passage: torchlight. Right passage: darkness and dripping water"

IF THE PLAYER SAID IT: You can quote it exactly as written
IF THE PLAYER DIDN'T SAY IT: The player character doesn't say it

REMEMBER: Players want to make their own choices and speak their own words. Give them situations to respond to, not responses you've decided for them.
</player_character_control>

<response_format>
You MUST respond with a JSON object matching this structure:
{
  "scene_text": "Full narrated resolution (200-400 words MAX, mostly dialogue and action)...",
  "time_passage": {"days": 0, "hours": 2, "description": "..."},
  "world_updates": {
    "pc_changes": [
      {
        "character_name_or_id": "CHARACTER_NAME",
        "changes": {
          "harm_damage": 2,
          "harm_healing": 0,
          "conditions_add": [{"name": "Bleeding", "category": "Physical", "description": "...", "mechanicalEffect": "..."}],
          "location": "New location",
          "relationship_changes": [{"entity_id": "npc_123", "entity_name": "Guard Captain", "trust_delta": 10, "reason": "Saved their life"}],
          "consequences_add": [{"type": "debt", "description": "Owes 50 gold"}],
          "appearance_changes": {"description": "Deep scar on cheek", "append": true},
          "equipment_changes": {"weapon": {"action": "remove", "value": "Broken sword"}},
          "inventory_changes": {"items_add": [...], "items_remove": [...], "items_modify": [...]},
          "resource_changes": {"gold_delta": -50, "contacts_add": [...]}
        }
      }
    ],
    "new_timeline_events": [...],
    "clock_changes": [...],
    "npc_changes": [
      {"npc_name_or_id": "EXISTING_NPC", "changes": {"notes_append": "New development..."}},
      {"npc_name_or_id": "New Character Name", "is_new": true, "changes": {"description": "Brief 1-sentence description of who they are", "notes_append": "Introduced as..."}}
    ],
    "faction_changes": [...],
    "location_changes": [
      {"name": "The Rusty Flagon", "is_new": true, "description": "A dimly-lit tavern reeking of pipe smoke and old ale.", "location_type": "inn"},
      {"name": "Irongate Keep", "gm_notes_append": "The portcullis is now damaged after the siege."}
    ],
    "organic_advancement": [...],
    "notes_for_gm": "..."
  }
}
</response_format>

<mechanics>
HARM SYSTEM:
- 6-segment harm track (0-6): 0-3 Fine | 4-5 Impaired (-1 to rolls) | 6 Taken Out
- Apply harm_damage when hurt in combat/danger, harm_healing when resting/treated
- Add conditions: Physical (Bleeding, Stunned), Emotional (Terrified), Special (Cursed)
- Remove conditions when narratively appropriate

MEDICAL TREATMENT: When someone (PC or NPC) tends a hurt character's
wounds — bandaging, healing magic, a field medic, anything more deliberate
than "they rest" — use medical_attention instead of guessing a
harm_healing number. Set skill to match who's treating them and
has_supplies to whether they have the means (bandages, potions, etc.) on
hand. It has no effect on a character who is unconscious/dying at 6 harm
— they need to be stabilized first (see below).

DYING STATE (only relevant once a character's conditions show them
critically dying — check the world state you were given, don't invent
this): a character who reaches 6 harm is automatically resolved by the
game system the moment it happens (stabilizes, gets a lasting injury, is
captured, or ends up critically dying) — you don't decide that outcome,
you'll just see the result reflected in their state on the next turn. If
a character's conditions show them critically dying, you have two more
narrative levers:
  - death_save_result: someone attempts to save them, or no one
    intervenes in time — narrate whether they cling to life ('success')
    or slip further ('failure') this turn.
  - heroic_sacrifice: the PLAYER chooses for their character to die
    meaningfully (never impose this — only use it if the player's own
    action clearly asked for it).
  Don't use either of these two fields for a character who isn't already
  critically dying.

ORGANIC CHARACTER GROWTH:
- Stats grow from -2 to +3 based on consistent use (keep total at +2, max one stat ≥ +2)
- Award perks for repeated tagged actions (combat, stealth, investigation)
- Growth driven by what characters DO, not player choices

TIME PASSAGE:
- Combat: minutes | Travel: hours | Investigation: hours | Rest: days
- Be realistic and include time_passage in response
- Examples: {"days": 0, "hours": 0, "description": "Mere moments"} | {"days": 1, "hours": 6, "description": "A day and a half"}
</mechanics>

<character_changes>
MODIFY CHARACTERS when narratively appropriate:

APPEARANCE: Use for permanent changes (lost limbs, scars, mutations, transformations)
- append=true: Add detail | append=false: Replace entirely
- Example: "Deep scar across left cheek from the blade" (append=true)

PERSONALITY: Use for trauma, development, or dramatic events
- Example: "Paranoid and suspicious after the betrayal" (append=true)

EQUIPMENT: Track significant narrative items (lucky sword, ancestral armor)
- "add": Found/received | "remove": Lost/destroyed | "replace": Upgraded

INVENTORY: items_add, items_remove, items_modify (quantity_delta)
- Track quest items, consumables, companions

RESOURCES: gold_delta, contacts_add/remove, reputation_changes
- Example: {"gold_delta": -50, "reputation_changes": [{"faction": "Thieves Guild", "delta": 10}]}

Make changes MATTER. Reference them in scene_text. Lost eye? Show how it affects vision. Equipment stolen? Show their reaction.
</character_changes>

<npc_tracking>
REGISTER NEW NPCs: Whenever you introduce a named character who doesn't already exist in the world state, add them to npc_changes with is_new: true and a brief description.
- This creates a persistent record so they can be referenced in future scenes
- Only skip is_new for NPCs already listed in the campaign world context
- Example: Guard captain you just named for the first time → register them
- Example: A faction leader already in the world state → just use notes_append
- Good description: "A grizzled dwarven blacksmith with a prosthetic left hand. Owns the Ember & Iron forge."

REGISTER NEW FACTIONS: Whenever a new organization, gang, guild, or group emerges mid-campaign (not in the starting world), add them to faction_changes with is_new: true.
- Include a description (who they are), goals (what they want), and current_plan (what they're doing right now)
- Example: A new criminal syndicate revealed mid-scene → register with is_new: true

REGISTER LOCATIONS: Whenever the characters visit or you describe a named place, add it to location_changes.
- is_new: true for the first time a location is named in the story
- description: sensory details — what it looks, sounds, smells like
- location_type: pick one of: town, city, dungeon, wilderness, inn, tavern, building, ruin, forest, road, sea, other
- For already-known locations, use gm_notes_append to record how it changed (fire damage, new guards, etc.)
- Good example: {"name": "The Hollow Bridge", "is_new": true, "description": "A crumbling stone arch over a black river. Moss covers every surface. Something moves in the water below.", "location_type": "wilderness"}
</npc_tracking>

<relationships>
Characters have HIDDEN relationship tracking (trust, tension, respect, fear) with NPCs/factions.
- Show relationships through NPC BEHAVIOR, not numbers
- NEVER reveal numeric values to players
- Use to determine: NPC reactions, dialogue tone, help/obstacles, betrayal/support

INTERPRETATION:
• Trust 50+: Helps freely, shares secrets | Trust -50: Withholds info, may betray
• Tension 50+: Confrontational, aggressive | Tension <10: Calm, cooperative
• Respect 50+: Defers, praises | Respect -50: Dismisses, ignores
• Fear 50+: Avoids, complies fearfully | Fear <10: Treats as equal

Relationship changes must feel EARNED. Enemies escalate through behavior, not exposition.
</relationships>

<important>
Be creative, dramatic, and true to the ${request.campaign_universe} universe while maintaining game balance.
</important>`
}

/**
 * Build the user prompt with all the world context and player actions
 * Updated with clearer structure and concise formatting
 */
function buildUserPrompt(request: AIGMRequest): string {
  const { world_summary, current_scene_intro, player_actions } = request

  return `<world_state>
Turn: ${world_summary.turn_number} | Date: ${world_summary.in_game_date}

PLAYER CHARACTERS:
${world_summary.characters.map(c => {
  const parts = [`${c.name}${c.description ? ` - ${c.description}` : ''}`]
  if (c.location) parts.push(`📍 ${c.location}`)
  if (c.backstory) parts.push(`Background: ${c.backstory}`)
  if (c.goals) parts.push(`Goals: ${c.goals}`)
  parts.push(`Stats: ${JSON.stringify(c.stats)}`)

  if (c.relationships && Object.keys(c.relationships).length > 0) {
    parts.push(`🔒 Hidden Relationships (use for NPC behavior): ${JSON.stringify(c.relationships)}`)
  }
  if (c.consequences && Object.keys(c.consequences).length > 0) {
    parts.push(`⚠️ Consequences: ${JSON.stringify(c.consequences)}`)
  }

  return `• ${parts.join('\n  ')}`
}).join('\n\n')}

IMPORTANT NPCs:
${world_summary.npcs.filter(n => n.importance >= 3).map(n =>
  `• ${n.name} - ${n.relationship || 'Neutral'} | Goals: ${n.goals || 'Unknown'} | Importance: ${n.importance}/5`
).join('\n')}

FACTIONS:
${world_summary.factions.map(f =>
  `• ${f.name} (Threat ${f.threatLevel}/5) - ${f.goals || 'Unknown'} | Plan: ${f.currentPlan || 'Unknown'}`
).join('\n')}

KNOWN LOCATIONS:
${world_summary.locations && world_summary.locations.length > 0
  ? world_summary.locations.map(l =>
    `• ${l.name}${l.type !== 'unknown' ? ` [${l.type}]` : ''}${l.description ? ` - ${l.description}` : ''}${l.weather ? ` | Weather: ${l.weather}${l.weather_severity ? ` (severity ${l.weather_severity}/5)` : ''} — reference this, don't invent different weather` : ''}`
  ).join('\n')
  : '(none discovered yet)'}

CLOCKS:
${world_summary.clocks.map(cl =>
  `• ${cl.name} [${cl.current_ticks}/${cl.max_ticks}] - ${cl.description} | Consequence: ${cl.consequence}`
).join('\n')}

RECENT TIMELINE:
${world_summary.recent_timeline_events.slice(0, 5).map(e =>
  `• Turn ${e.turn_number}: ${e.title} - ${e.summary}`
).join('\n')}
</world_state>

<current_scene>
${current_scene_intro}
</current_scene>

<player_actions>
${player_actions.map(a => `${a.character_name}: "${a.action_text}"`).join('\n\n')}
</player_actions>

<task>
1. ACTION-FOCUSED NARRATION (scene_text) - 200-400 words MAX:
   • FIRST SENTENCE: State the immediate outcome/result
   • DIALOGUE HEAVY: 30%+ should be NPCs speaking and reacting
   • MINIMAL atmospheric description - focus on action and dialogue
   • Reference each character BY NAME as they ACT
   • Be CONCRETE: "She drew her blade" not "A weapon gleamed in the shadows"
   • PACE: Fast action = short sentences, Key moments = brief pause
   • Show consequences through what characters DO and SAY, not feelings
   • ONLY describe setting when immediately relevant to the action
   • End with clear outcome and what happens next
   • Think "action movie script" or "play-by-play commentary" not "novel"
   • PLAYER CHARACTERS: Only describe their submitted actions - NO dialogue, NO thoughts, NO feelings, NO extra actions

2. WORLD STATE CHANGES (world_updates):
   • Apply harm, conditions, location changes based on what happened
   • Update relationships through NPC behavior
   • Advance clocks if warranted
   • Create timeline events for significant outcomes
   • Track all character changes (equipment, inventory, resources)

CRITICAL REMINDERS:
❌ NO flowery descriptions or atmospheric writing
❌ NO player character dialogue unless quoting their exact submitted action
❌ NO player character thoughts, feelings, or internal states
❌ NO actions for player characters beyond what they submitted

✓ FOCUS: What happened, what NPCs said/did, what's the next challenge
✓ BREVITY: Cut ruthlessly - every sentence must advance the plot

Respond with valid JSON matching the schema.
</task>`
}

/**
 * Simpler AI call for background world turns
 * This generates offscreen events when no players are involved
 */
export async function callAIForWorldTurn(
  campaignUniverse: string,
  aiSystemPrompt: string,
  worldSummary: any,
  clocksAboutToComplete: any[],
  campaignId?: string,
  completedGoalNpcs: Array<{ npcId: string; npcName: string; completedGoal: string | number }> = []
): Promise<{
  offscreen_events: Array<{
    title: string
    summary_public: string
    summary_gm: string
  }>
  gm_notes: string
  // Structured consequences of the offscreen events above, applied through
  // the same path scene resolution uses (applyWorldUpdates) — so e.g. a
  // tournament winner becomes a real, queryable NPC record instead of
  // existing only as a sentence in an event summary. Deliberately a subset
  // of AIGMResponse['world_updates']: no pc_changes (offscreen events don't
  // touch player characters) and no clock_changes (clock advancement is
  // handled separately in worldTurn.ts, not by this call).
  world_updates?: {
    npc_changes?: AIGMResponse['world_updates']['npc_changes']
    faction_changes?: AIGMResponse['world_updates']['faction_changes']
  }
}> {
  const apiKey = process.env.OPENAI_API_KEY
  const startTime = Date.now()

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured')
  }

  const systemPrompt = `${aiSystemPrompt}

You are generating OFFSCREEN events - things happening in the background while players are elsewhere.
Focus on villain plans, faction moves, and clock consequences.
Keep it brief and impactful.`

  const goalCompletionNote = completedGoalNpcs.length > 0
    ? `\n\nThese major NPCs just achieved their goal and need a new direction:
${completedGoalNpcs.map(n => `- ${n.npcName} (id: ${n.npcId}) completed: ${n.completedGoal}`).join('\n')}

For each one, include an offscreen event narrating the outcome of what they
achieved, AND a npc_changes entry with npc_name_or_id set to their id above
and changes.goals set to their new long-term goal — someone who just won a
tournament or completed a scheme doesn't stop existing, they move on to
something else. Don't leave any of them without a new goals value.`
    : ''

  const userPrompt = `World State Summary:
${JSON.stringify(worldSummary, null, 2)}

Clocks about to complete or recently advanced:
${JSON.stringify(clocksAboutToComplete, null, 2)}
${goalCompletionNote}

Generate 1-3 brief offscreen events that show villains/factions making moves.

If an event produces a lasting outcome — a named winner, a new rival, a
faction gaining or losing ground — record it in world_updates so it becomes
a real, persistent part of the world instead of only existing in this
summary text. Use npc_changes with is_new: true to introduce anyone the
event produces (a tournament winner, a new claimant, a survivor) so they
can be found and questioned later and will remember what happened to them.
Only include world_updates when an event actually warrants it — most minor
flavor events don't need any.

Respond with JSON:
{
  "offscreen_events": [
    {
      "title": "...",
      "summary_public": "What players might hear about...",
      "summary_gm": "Full details including villain intentions..."
    }
  ],
  "world_updates": {
    "npc_changes": [
      {"npc_name_or_id": "New Character Name", "is_new": true, "changes": {"description": "Brief description, including what they just did or won", "notes_append": "..."}}
    ],
    "faction_changes": [
      {"faction_name_or_id": "EXISTING_FACTION", "changes": {"gm_notes_append": "..."}}
    ]
  },
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
        model: AI_MODELS.EFFICIENT, // Cost optimization: efficient model for background world turns
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.75, // Balanced creativity
        max_tokens: 1000, // Brief offscreen events (cost optimization)
        response_format: { type: 'json_object' }
      })
    })

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`)
    }

    const data = await response.json()
    const content = data.choices[0].message.content

    if (campaignId) {
      const usage = data.usage || {}
      await recordAICost({
        campaignId,
        model: AI_MODELS.EFFICIENT,
        requestType: 'offscreen_events',
        inputTokens: usage.prompt_tokens || estimateTokenCount(systemPrompt + userPrompt),
        outputTokens: usage.completion_tokens || estimateTokenCount(content),
        responseTimeMs: Date.now() - startTime,
        success: true
      }).catch(console.error)
    }

    return JSON.parse(content)
  } catch (error) {
    console.error('World turn AI call failed:', error)
    // Return empty result rather than crashing
    return {
      offscreen_events: [],
      gm_notes: 'AI call failed - world turn skipped'
    }
  }
}
