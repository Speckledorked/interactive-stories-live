import { openaiFetch } from '@/lib/ai/openaiCompat'
// src/lib/ai/client.ts
// OpenAI client wrapper
// This handles all communication with the AI model
// Phase 15: Enhanced with strict validation, error handling, and cost tracking

import { validateAIResponseWithRepair } from './validation'
import { circuitBreakerManager } from './circuit-breaker'
import { AICostTracker, estimateTokenCount, recordAICost } from './cost-tracker'
import { AI_MODELS } from './models'
import { AMBITION_CATEGORY_OPTIONS } from '@/lib/game/tick/ambitionTick'

/**
 * AI GM Response Structure
 * This is what we expect back from the AI after resolving a scene
 */
export interface AIGMResponse {
  scene_text: string // The narrated resolution
  time_passage?: {
    // How much in-game time has passed in this exchange — the engine
    // derives the new date and banks world-turn hours from days/hours
    // alone (see elapsedInGameHours in lib/game/tick/pacing.ts, which
    // clamps a single scene to MAX_TIME_PASSAGE_HOURS_PER_SCENE); there is
    // no separate date-string override field.
    days?: number // Days elapsed
    hours?: number // Hours elapsed (in addition to days)
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
        // New or updated long-term goal — a new NPC's starting goal, or a
        // fresh direction for an existing major NPC whose previous goal
        // just completed.
        goals?: string
        // Minimal harm tracking (see NPC.harm in schema.prisma) — mirrors
        // pc_changes.harm_damage below, applied via the same engine harm math.
        harm_damage?: number
        // Names the PC whose action dealt this damage, so their equipped
        // weapon's damage bonus applies. Omit for damage with no clear
        // attacking PC (a trap, another NPC, an environmental hazard).
        harm_damage_dealt_by?: string
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
            // Exact armor reduction (0-3) this item grants, if it's armor —
            // used in place of guessing one from the name string when this
            // item is equipped (see lib/game/inventory.ts's resolveArmorValue).
            armorValue?: number
            // Broad display categorization — purely informational.
            itemType?: 'weapon' | 'armor' | 'consumable' | 'quest' | 'currency' | 'misc'
            // Exact damage bonus (0-3) this item grants, if it's a weapon —
            // symmetric to armorValue (see resolveDamageBonus).
            damageBonus?: number
            // A consumable's mechanical payoff when used — 'heal' is
            // enforced (see resolveConsumableHeal), 'custom' is flavor-only.
            effect?: { kind: 'heal' | 'custom'; amount?: number; description: string }
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
        // Knowledge-relative sheet: what the fiction revealed, unlocked,
        // or exercised — see lib/game/capabilities.ts CapabilityChange.
        capability_changes?: Array<{
          capability_key: string
          change: 'glimpse' | 'unlock' | 'progress'
          is_new?: boolean
          name?: string
          domain?: string
          framed_label?: string
          hint?: string
          reason: string
        }>
        // Debt economy: favors incurred or settled — see lib/game/debts.ts.
        debt_changes?: Array<{
          counterparty_name: string
          counterparty_type: 'npc' | 'faction'
          direction: 'owed_by_character' | 'owed_to_character'
          action: 'incur' | 'resolve'
          description: string
          reason: string
        }>
        // Faction standing shifts earned this scene — see lib/game/standing.ts.
        standing_changes?: Array<{
          faction_name: string
          delta: number
          reason: string
        }>
        // Corruption mark (see lib/game/corruption.ts) — ONLY meaningful in
        // campaigns with a corruption theme; server clamps to 1 mark/scene.
        corruption_change?: {
          marks: number
          reason: string
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
        gm_notes_append?: string
        // World Sim Phase 6: only set when a player character who leads
        // this faction makes a strategic decision in-scene — see
        // schema.ts's FactionChangesSchema for the full reasoning.
        goal?: 'EXPAND' | 'DEFEND' | 'ENRICH' | 'DESTABILIZE_RIVAL' | 'CONSOLIDATE'
      }
    }>
    location_changes?: Array<{
      name: string
      is_new?: boolean       // true when registering a location for the first time
      description?: string   // what this place looks, feels, smells like
      location_type?: string // town, dungeon, wilderness, inn, building, etc.
      gm_notes_append?: string
    }>
    // Corruption bargains narrated this scene — persisted so the
    // character's NEXT action can mechanically invoke them (surge bonus
    // at roll time). Only meaningful in campaigns with a corruption theme.
    bargain_offers?: Array<{
      character_name_or_id: string
      offer: string
    }>
    // Quest lifecycle: open when the fiction hands the party a job/goal,
    // append progress beats as scenes advance it, close when it settles.
    quest_changes?: Array<{
      name: string
      is_new?: boolean // true when a quest is taken on for the first time
      changes: {
        description?: string // what this quest is, for new quests
        objective?: string   // what "done" looks like
        given_by?: string    // NPC/faction that issued it
        reward?: string      // what was promised, if anything (flavor text only — see reward_grant)
        status?: 'ACTIVE' | 'COMPLETED' | 'FAILED' | 'ABANDONED'
        progress_append?: string // one beat of progress made THIS scene
        // Structured payout, applied deterministically when status becomes
        // COMPLETED this turn — the actual mechanism behind `reward` above.
        // Only meaningful alongside status: 'COMPLETED'.
        reward_grant?: {
          character_names?: string[] // recipients; absent/empty = every living party member
          gold?: number
          items?: Array<{
            id: string; name: string; quantity: number; tags: string[]
            armorValue?: number
            itemType?: 'weapon' | 'armor' | 'consumable' | 'quest' | 'currency' | 'misc'
            damageBonus?: number
            effect?: { kind: 'heal' | 'custom'; amount?: number; description: string }
          }>
          standing_changes?: Array<{ faction_name: string; delta: number; reason: string }>
        }
      }
    }>
    organic_advancement?: Array<{
      character_id: string
      stat_increases?: Array<{
        stat_key: string
        delta: number
        reason: string
      }>
      // Small, specific bonuses earned from a repeated pattern in what
      // this character has actually done — see ORGANIC CHARACTER GROWTH
      // below. id is derived server-side from name; don't invent one.
      new_perks?: Array<{
        name: string
        description: string
        tags?: string[]
      }>
      // Rare, narratively-earned signature tricks — see the <moves>
      // guidance below. id is derived server-side from name; don't invent one.
      new_moves?: Array<{
        name: string
        trigger: string
        description: string
      }>
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
      // Knowledge-relative sheet (see lib/game/capabilities.ts): what this
      // character knows exists and can do — qualitative bands only.
      origin_familiarity?: string
      capabilities?: {
        known: Array<{ name: string; domain: string; band: string; description: string | null }>
        glimpsed: Array<{ domain: string; hint: string | null }>
        knownDomains: string[]
      }
      // Open favors, both directions (see lib/game/debts.ts).
      debts?: {
        owedByCharacter: Array<{ counterparty: string; description: string }>
        owedToCharacter: Array<{ counterparty: string; description: string }>
      }
      // Social position with discovered active factions (see standing.ts).
      standings?: Array<{ faction: string; label: string }>
      // Qualitative corruption state — only set when the campaign has a
      // corruption theme (see lib/game/corruption.ts). Never a raw number.
      corruption_status?: string
    }>
    npcs: Array<{
      id: string
      name: string
      description: string | null
      goals: string | null
      relationship: string | null
      importance: number
      // World Sim Phase 4: bare ids — cross-reference against `factions`
      // below for the name. Absent from that array = the faction is
      // undiscovered, so don't name it in the prompt.
      factionId?: string | null
      factionRole?: string | null
    }>
    factions: Array<{
      id: string
      name: string
      goals: string | null
      currentPlan: string | null
      // Fog of war: qualitative descriptors, not raw numbers — see
      // qualitativeStats.ts. The old numeric threatLevel/resources/influence
      // shape predates that pass and no longer exists here.
      threat_level: string
      resources: string
      influence: string
      // World Sim Phase 6: set when a player character leads this faction.
      leader_character_id?: string | null
    }>
    locations?: Array<{
      name: string
      description: string
      type: string
      weather?: string
      weather_severity?: number
      owner_faction_id?: string | null
      is_contested?: boolean
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
    // World Sim Phase 5: active wars, coalition ally counts included.
    wars?: Array<{
      name: string
      attacker: string
      defender: string
      attacker_allies: number
      defender_allies: number
      momentum: string
      turns_elapsed: number
    }>
    // Open quests, so the AI progresses/closes existing undertakings
    // instead of re-registering or forgetting them.
    quests?: Array<{
      name: string
      description: string
      objective: string | null
      given_by: string | null
      recent_progress: string | null
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
    // Imported reference lore (paste/URL/wiki — see lib/lore/) relevant to
    // this scene, mirrors relevant_campaign_history but for static
    // world-bible content rather than play history.
    relevant_lore?: Array<{
      title: string
      content: string
      relevance: string
    }>
    // Pre-formatted campaign overview text for large campaigns (see
    // buildOptimizedWorldSummary); empty/absent for small ones.
    _campaignSummary?: string
  }
  current_scene_intro: string
  // The campaign's corruption theme, when this universe has one — gates the
  // <corruption> prompt section and the corruption_change response channel.
  corruption_theme?: {
    name: string
    description: string
    bargainGuidance?: string
    // The campaign's forbidden arts — capability nodes only the marked can
    // unlock (required_marks = the node's tier; enforced by the engine).
    shadow_arts?: Array<{ name: string; domain: string; required_marks: number }>
  } | null
  // Lines and veils (see lib/safety/safety-service.ts) — hard/soft content
  // boundaries the table set. Empty arrays when unset; gates the <safety>
  // prompt section entirely so campaigns that never touched this incur no
  // prompt cost.
  safety_lines?: string[]
  safety_veils?: string[]
  player_actions: Array<{
    character_name: string
    character_id: string
    action_text: string
    // Server-rolled move outcome (see lib/game/resolution.ts) — a binding
    // constraint on how well this action goes. Absent = freeform.
    mechanics?: {
      move_name: string
      outcome: 'strongHit' | 'weakHit' | 'miss'
      outcome_text: string
      // True when this roll was powered by accepting an open corruption
      // bargain — narrate the borrowed power working, and the price.
      corruption_surge?: boolean
    }
  }>
  // Full roll records for this exchange, carried through so the resolver
  // can store receipts — not rendered into the prompt directly.
  action_mechanics?: import('@/lib/game/resolution').ActionMechanics[]
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

  // Build the full prompt for the AI
  const systemPrompt = buildSystemPrompt(request)
  const userPrompt = buildUserPrompt(request)

  console.log('🤖 Calling AI GM...')
  console.log('System prompt length:', systemPrompt.length)
  console.log('User prompt length:', userPrompt.length)

  // Estimate token count for cost tracking
  const estimatedInputTokens = estimateTokenCount(systemPrompt + userPrompt)

  try {
    const response = await openaiFetch('https://api.openai.com/v1/chat/completions', {
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

    // Phase 15.2: Validate response with progressive fallback.
    // Depth-hardening #36: one bounded repair round-trip is attempted
    // first (see validateAIResponseWithRepair) before falling through to
    // the existing degradation ladder — a fixable shape mistake gets a
    // real chance to be fixed instead of immediately discarding all
    // mechanical content for the scene.
    const validationResult = await validateAIResponseWithRepair(
      parsedResponse,
      request.current_scene_intro,
      async (repairPrompt: string) => {
        const repairStartTime = Date.now()
        const repairResponse = await openaiFetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: AI_MODELS.FLAGSHIP,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
              { role: 'assistant', content },
              { role: 'user', content: repairPrompt }
            ],
            temperature: 0.7,
            max_tokens: 4000,
            response_format: { type: 'json_object' }
          })
        })

        if (!repairResponse.ok) {
          throw new Error(`Repair call failed: ${repairResponse.status}`)
        }

        const repairData = await repairResponse.json()
        const repairContent = repairData.choices[0].message.content
        const repairUsage = repairData.usage || {}

        // A real API call with real spend — tracked distinctly from the
        // main resolution call so it's visible in cost breakdowns, not
        // silently folded into 'scene_resolution'.
        if (campaignId) {
          const repairCostTracker = new AICostTracker(campaignId, AI_MODELS.FLAGSHIP)
          await repairCostTracker.recordRequest({
            inputTokens: repairUsage.prompt_tokens || estimateTokenCount(systemPrompt + userPrompt + content + repairPrompt),
            outputTokens: repairUsage.completion_tokens || estimateTokenCount(repairContent),
            responseTimeMs: Date.now() - repairStartTime,
            success: true,
            cacheHit: false,
            sceneId,
            requestType: 'scene_resolution_repair'
          }).catch(console.error)
        }

        return JSON.parse(repairContent)
      }
    )

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
          "resource_changes": {"gold_delta": -50, "contacts_add": [...]},
          "capability_changes": [{"capability_key": "swordplay", "change": "progress", "reason": "Survived a duel"}],
          "debt_changes": [{"counterparty_name": "Lord Kessler", "counterparty_type": "npc", "direction": "owed_by_character", "action": "incur", "description": "Smuggled the party out of the city", "reason": "A real favor with expectation of return"}],
          "standing_changes": [{"faction_name": "Thieves Guild", "delta": 1, "reason": "Returned their stolen ledger"}]
        }
      }
    ],
    "new_timeline_events": [...],
    "clock_changes": [...],
    "npc_changes": [
      {"npc_name_or_id": "EXISTING_NPC", "changes": {"notes_append": "New development..."}},
      {"npc_name_or_id": "New Character Name", "is_new": true, "changes": {"description": "Brief 1-sentence description of who they are", "notes_append": "Introduced as..."}},
      {"npc_name_or_id": "Bandit Leader", "changes": {"harm_damage": 3, "harm_damage_dealt_by": "CHARACTER_NAME", "notes_append": "Wounded in the ambush"}}
    ],
    "faction_changes": [
      {"faction_name_or_id": "EXISTING_FACTION", "changes": {"gm_notes_append": "New development..."}},
      {"faction_name_or_id": "PLAYER_LED_FACTION", "changes": {"goal": "EXPAND", "current_plan": "Massing at the border for a spring offensive"}}
    ],
    "location_changes": [
      {"name": "The Rusty Flagon", "is_new": true, "description": "A dimly-lit tavern reeking of pipe smoke and old ale.", "location_type": "inn"},
      {"name": "Irongate Keep", "gm_notes_append": "The portcullis is now damaged after the siege."}
    ],
    "quest_changes": [
      {"name": "The Missing Caravan", "is_new": true, "changes": {"description": "Merchants vanished on the north road", "objective": "Find the caravan and learn what took it", "given_by": "Guildmaster Oren", "reward": "200 gold and guild favor"}},
      {"name": "EXISTING_QUEST", "changes": {"progress_append": "Found wolf tracks that turn to bootprints at the river"}},
      {"name": "ANOTHER_EXISTING_QUEST", "changes": {"status": "COMPLETED", "progress_append": "Delivered the ledger to the magistrate", "reward_grant": {"gold": 200, "standing_changes": [{"faction_name": "Merchants Guild", "delta": 1, "reason": "Delivered the ledger as promised"}]}}}
    ],
    "organic_advancement": [
      {"character_id": "CHARACTER_NAME", "new_perks": [{"name": "Riposte", "description": "You counter, you don't just block. +1 when you strike back at an opponent who's just missed you.", "tags": ["combat"]}], "new_moves": [{"name": "Read the Room", "trigger": "When you enter a tense negotiation", "description": "You always get one honest tell from the room before anyone speaks."}]}
    ],
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
- NPCs have the same 0-6 harm track for real physical harm (see NPC HARM under REGISTER NEW NPCs below) — but no conditions/death-saves/dying state; they're just fine, impaired, or taken out

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
- Stats grow from -2 to +3 based on consistent use (keep total at +2, max one stat ≥ +2) — the engine detects this on its own from roll outcomes; you don't need to report it.
- Perks (organic_advancement.new_perks) are small, specific bonuses earned from a repeated PATTERN in what THIS character has actually done — there is no fixed list, and you decide both when one's earned and what it is. Ground it in this campaign's setting and this character's own actions/backstory, never a generic reskin: a duelist who's fought a dozen blade-fights earns something bladed and specific ("Riposte: +1 when you counter an opponent who's just missed you"), not "+1 to combat"; a hacker in a cyberpunk campaign earns something about reading network traffic, not "keen eye." Two different characters who both fight a lot should end up with different perks if their fights actually played out differently. {"name": "Riposte", "description": "You counter, you don't just block. +1 when you strike back at an opponent who's just missed you.", "tags": ["combat"]} — don't invent an id; the engine derives one from name. Reserve for a genuine repeated pattern (roughly once every several sessions per character), not every scene.
- New moves (organic_advancement.new_moves) are different: a RARE, one-time reward for a genuine narrative turning point, not routine competence — a mentor taught them a signature technique, they survived by exploiting one specific trait, a transformation left them permanently changed. Reserve for maybe once every several sessions per character. {"name": "Read the Room", "trigger": "When you enter a tense negotiation", "description": "You always get one honest tell from the room before anyone speaks."} — trigger names the situation it applies to, description says what it does. Don't invent an id; the engine derives one from name.
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
- If an added item is armor, set armorValue to the exact protection it grants (0-3: 1 light/leather, 2 medium/chain, 3 heavy/plate) — this is what the engine actually uses when it's equipped, instead of guessing from the name. Omit for anything that isn't armor
- If an added item is a weapon that's clearly exceptional (masterwork, enchanted, legendary, or notably heavy/two-handed), set damageBonus (0-3) the same way — an ordinary weapon just omits it
- Set itemType (weapon/armor/consumable/quest/currency/misc) on every added item — purely a display label, costs nothing to include
- If an added item is a consumable that should actually heal when used (a real healing potion, not just flavor), set effect: {"kind": "heal", "amount": N, "description": "..."} — the engine applies N harm healed automatically the moment the item is consumed (items_remove, or items_modify with a negative delta), you don't also need to set harm_healing for it. For any other kind of item effect (a charm, a specific-use key, anything that doesn't heal), use effect: {"kind": "custom", "description": "..."} — this is flavor text only, nothing mechanical happens, so still narrate its effect yourself in scene_text

RESOURCES: gold_delta, contacts_add/remove, reputation_changes
- Example: {"gold_delta": -50, "reputation_changes": [{"faction": "Thieves Guild", "delta": 10}]}

Make changes MATTER. Reference them in scene_text. Lost eye? Show how it affects vision. Equipment stolen? Show their reaction.
</character_changes>

<debts>
Debts are owed favors between player characters and NPCs/factions — the social currency of this world. Each character's "Debts:" line lists their open favors, both directions.

USE DEBTS AS DRAMA:
- INCUR: when someone does a PC a real favor (or vice versa) with an implicit expectation of return — rescue, protection, information, money, looking the other way — record it. Debts must be EARNED in the fiction, never invented retroactively.
- CALL IN: NPCs and factions remember. When it serves the story, have a creditor show up wanting repayment — at the worst possible time is best. A called-in debt is pressure, not a transaction: refusing has social consequences (burned relationships, new enemies, reputation).
- RESOLVE: when a debt is honored, refused, traded away, or forgiven, resolve it with how it ended.

Report via debt_changes inside that character's pc_changes:
- {"counterparty_name": "Lord Kessler", "counterparty_type": "npc", "direction": "owed_by_character", "action": "incur", "description": "Smuggled the party out of the burning district", "reason": "Kessler's men saved them at real cost"}
- {"counterparty_name": "Thieves Guild", "counterparty_type": "faction", "direction": "owed_by_character", "action": "resolve", "description": "Repaid by stealing the ledger for them", "reason": "The job is done"}

NEVER present debts as numbers or a ledger in scene_text — they live in the fiction: a meaningful look, a reminder over drinks, a knock on the door at midnight.
</debts>

<faction_standing>
Each character's "Standing:" line is their social position with the world's factions (hunted → hostile → distrusted → unknown → favored → trusted → honored). Standing already modifies the dice behind the scenes — your job is the social texture and the shifts:

- SHOW standing through behavior: guards wave a favored character through, merchants of a hostile faction refuse service, a hunted character gets recognized at the worst moment.
- SHIFT standing when a scene genuinely earns it — public service or public betrayal, taking a side in their conflict, honoring or refusing a called-in debt. Report via standing_changes inside that character's pc_changes: {"faction_name": "Thieves Guild", "delta": 1, "reason": "Returned the guild's stolen ledger without reading it"}
- One step at a time: deltas beyond ±1 are clamped by the engine. Reputations are earned scene by scene, not swung in one.
- Standing is with REAL factions from the FACTIONS list only. NPCs' personal feelings are the relationship system, not standing.
- NEVER state standing levels or numbers in scene_text — express position purely through how the faction's people treat them.
</faction_standing>

<mechanical_outcomes>
Some player actions arrive with a MECHANICAL OUTCOME line — the game engine already rolled the dice for that action. This outcome is BINDING:
- STRONG HIT: the attempt succeeds cleanly. Don't undercut it with hidden costs the roll didn't earn.
- WEAK HIT: the attempt succeeds, but ALWAYS with a real cost, complication, or hard choice — never a clean win.
- MISS: it goes wrong. Make a hard GM move against them: harm, a threat materializes, a cost is paid, an opportunity is lost, the situation worsens. A miss is never "nothing happens".
Actions without a MECHANICAL OUTCOME line are yours to adjudicate freely (dialogue, planning, low-stakes activity).
NEVER mention dice, rolls, moves, hits, or misses in scene_text — express outcomes purely through the fiction. The engine's outcome decides HOW WELL it went; you decide what that looks like.
</mechanical_outcomes>

<capabilities>
Each player character's sheet shows their KNOWLEDGE of this world's systems, not a fixed class. Their entry lists: Abilities (what they can do, with a skill band), "Aware of but cannot do" (glimpsed), and "Systems this character knows exist".

NARRATION GATING — this is fog of war applied to the character themselves:
- NEVER explain or name systems that are NOT in a character's known list. An outsider who has never seen essence magic doesn't get exposition about ranks or essences — they see "impossible things" they lack words for. NPCs may use and reference such systems freely; the NARRATOR must not translate for an ignorant character.
- Respect skill bands: a novice swordsman fumbles what a masterful one does effortlessly. Never let narration outrun the band.
- Use a character's own vocabulary for foreign-framed abilities until the fiction teaches them local terms.

CAPABILITY CHANGES — report what the fiction did via capability_changes inside that character's pc_changes:
- "glimpse": they witnessed/learned a system EXISTS. {"capability_key": "essence-magic", "change": "glimpse", "hint": "Villagers drew power from colored stones", "reason": "Watched the ritual in the square"}
- "unlock": they can now DO it (first real acquisition — absorbed the essence, completed first training, was initiated). {"capability_key": "dark-essence", "change": "unlock", "reason": "Absorbed the dark essence at the shrine"}
- "progress": they meaningfully exercised or trained an ability THIS scene (real stakes or deliberate practice — not incidental mention). {"capability_key": "swordplay", "change": "progress", "reason": "Survived a duel with the caravan guard"}
- New system revealed that isn't listed anywhere? Add is_new with name + domain: {"capability_key": "blood-runes", "change": "glimpse", "is_new": true, "name": "Blood Runes", "domain": "Forbidden Arts", "hint": "The cultist carved glowing sigils in her own skin", "reason": "..."}
- Use framed_label when a character understands an ability only in their own terms: {"capability_key": "swordplay", "change": "unlock", "framed_label": "Kendo forms", "reason": "..."}

You decide WHAT happened; the game engine decides how much growth it's worth. Do not narrate sudden mastery — growth is slow, and the engine will cap it regardless of what the prose claims.
</capabilities>
${request.corruption_theme ? `
<corruption>
THIS UNIVERSE'S POWER-AT-A-COST: "${request.corruption_theme.name}" — ${request.corruption_theme.description}
${request.corruption_theme.bargainGuidance ? `When a bargain fits: ${request.corruption_theme.bargainGuidance}` : ''}

Corruption is a devil's bargain the PLAYER walks into, never something you impose:
- Offer a bargain SPARINGLY (at most once every few scenes) at a moment of real desperation — typically on a miss: name what ${request.corruption_theme.name} could do for them right now, and what it will cost. Let the player's next action accept or refuse
- Whenever you narrate an offer, ALSO record it structurally in world_updates.bargain_offers: [{"character_name_or_id": "...", "offer": "one sentence naming the power and the price"}]. This is what lets the engine honor the bargain mechanically on their next roll — an offer that exists only in prose has no mechanical teeth
- If a character's action line shows CORRUPTION SURGE, they accepted: the engine already boosted that roll. Narrate the borrowed power genuinely working, and report {"corruption_change": {"marks": 1, "reason": "..."}} inside that character's pc_changes. For marks outside a formal bargain (a character deliberately drawing on ${request.corruption_theme.name} unprompted), report corruption_change the same way. The engine caps marks at one per scene and they NEVER go away
- When a character accepts, the power works — narrate a real, immediate benefit, not a monkey's paw. The cost is the mark itself and what it slowly makes of them
- Each character's current state is on their "Corruption:" line in PLAYER CHARACTERS. Weave that stage into narration as an undertone; never name numbers or mechanics in prose
- A character whose conditions show "${'Consumed'}" has reached the end of the track — ${request.corruption_theme.name} is claiming them; play their unraveling honestly
- NEVER treat a merely dark-flavored ability as corrupting. Only ${request.corruption_theme.name} itself, as defined above, marks corruption
${request.corruption_theme.shadow_arts && request.corruption_theme.shadow_arts.length > 0 ? `
SHADOW ARTS — this world's forbidden arts, wieldable only by the marked:
${request.corruption_theme.shadow_arts.map(s => `- ${s.name} (${s.domain})`).join('\n')}
These may be glimpsed by anyone — rumors, forbidden texts, witnessing one used — but they refuse the unmarked. Only a character already carrying enough of ${request.corruption_theme.name} can unlock one; the engine enforces this, downgrading premature unlocks to glimpses. Narrate a premature attempt as the art itself resisting: it wants more of them first. Never present learning one as safe or free.` : ''}
</corruption>
` : ''}
${(request.safety_lines && request.safety_lines.length > 0) || (request.safety_veils && request.safety_veils.length > 0) ? `
<safety>
This table set explicit content boundaries. These override everything else in this prompt, including genre conventions and dramatic instinct.
${request.safety_lines && request.safety_lines.length > 0 ? `
LINES — HARD limits. NEVER include, reference, or approach these, even obliquely, even for a single sentence. If the scene is heading toward one, steer it elsewhere before it arrives — do not "fade to black" on a line, avoid it entirely:
${request.safety_lines.map(l => `- ${l}`).join('\n')}` : ''}
${request.safety_veils && request.safety_veils.length > 0 ? `
VEILS — soft limits. These may happen OFF-PAGE: acknowledge that something occurred, then cut away before any detail. Never describe them directly:
${request.safety_veils.map(v => `- ${v}`).join('\n')}` : ''}
</safety>
` : ''}

<npc_tracking>
REGISTER NEW NPCs: Whenever you introduce a named character who doesn't already exist in the world state, add them to npc_changes with is_new: true and a brief description.
- This creates a persistent record so they can be referenced in future scenes
- Only skip is_new for NPCs already listed in the campaign world context
- Example: Guard captain you just named for the first time → register them
- Example: A faction leader already in the world state → just use notes_append
- Good description: "A grizzled dwarven blacksmith with a prosthetic left hand. Owns the Ember & Iron forge."

NPC HARM: When a PC's action deals real physical harm to an NPC (a fight, a wound, a killing blow), set harm_damage on that NPC's npc_changes entry — same 0-6 scale as pc_changes.harm_damage (0-3 fine, 4-5 impaired, 6 taken out — the engine flips them non-alive automatically at 6, don't set that yourself). Set harm_damage_dealt_by to the attacking PC's name when there is one, so their weapon's damage bonus applies; leave it unset for damage from a trap, another NPC, or anything with no clear PC attacker. Don't set harm_damage for damage that's purely narrative flavor (a glancing blow that changes nothing) — only for harm that should actually move them toward being taken out of the fight.

REGISTER NEW FACTIONS: Whenever you name an organization, gang, guild, house, or group that isn't already in the FACTIONS list below, add them to faction_changes with is_new: true — same rule as NPCs: check the list, not whether it "feels" pre-established. A major house that's obviously part of the setting's lore but has never actually appeared in the FACTIONS list still needs registering the first time you name it, or it will never exist as a real faction the party can interact with, build standing with, or see tracked.
- Include a description (who they are), goals (what they want), and current_plan (what they're doing right now)
- Only skip is_new for factions already listed in the FACTIONS list
- Example: A new criminal syndicate revealed mid-scene → register with is_new: true
- Example: The player finally meets a noble house that's been referenced only in passing but was never in the FACTIONS list → register it now, this is still the first time it's real

PLAYER-LED FACTIONS: Factions marked "LED BY PLAYER CHARACTER: <name>" in the FACTIONS list are led by that player character. If that player makes a genuine strategic decision as the leader this scene (e.g. "As Duke, I commit our forces to retaking the border fort" or "I redirect the guild toward trade instead of war"), set changes.goal on that faction to the matching value (EXPAND, DEFEND, ENRICH, DESTABILIZE_RIVAL, or CONSOLIDATE).
- Only do this for factions the player actually leads — for every other faction, goal is decided automatically by the simulation and setting it here has no effect
- A player's held or intended actions (not yet acted on) don't count — only a decision actually made this scene

REGISTER LOCATIONS: Whenever the characters visit or you describe a named place, add it to location_changes.
- is_new: true for the first time a location is named in the story
- description: sensory details — what it looks, sounds, smells like
- location_type: pick one of: town, city, dungeon, wilderness, inn, tavern, building, ruin, forest, road, sea, other
- For already-known locations, use gm_notes_append to record how it changed (fire damage, new guards, etc.)
- Good example: {"name": "The Hollow Bridge", "is_new": true, "description": "A crumbling stone arch over a black river. Moss covers every surface. Something moves in the water below.", "location_type": "wilderness"}

TRACK QUESTS: Whenever the fiction hands the party a concrete job, goal, or promise with a "done" state — an NPC asks for help, a faction offers work, the party commits to a rescue/heist/investigation — register it in quest_changes with is_new: true (name, description, objective, given_by, reward if promised). Check the ACTIVE QUESTS list below first; only register genuinely new undertakings.
- Every scene that meaningfully advances an active quest, add a progress_append beat for it (one sentence, concrete: what was learned/gained/lost)
- When a quest resolves — success, failure, or the party walking away — set status to COMPLETED, FAILED, or ABANDONED, with a final progress_append saying how
- When a quest is COMPLETED and a reward was promised, include reward_grant with the actual payout (gold, items, standing_changes) — this is what mechanically pays it out; the reward text alone is flavor and grants nothing by itself. Only include what was genuinely promised; omit reward_grant entirely if nothing concrete was owed
- Vague ambitions ("get stronger", "explore the city") are NOT quests; only track things with a specific fictional endpoint

TRACK PC LOCATION: Whenever a player character's physical location changes during this scene — walks into another room, leaves a building, travels to a new place, is moved/carried/dragged somewhere — set changes.location in that character's pc_changes entry to where they are NOW, matching the name you used in location_changes.
- This applies to small moves too (tavern common room → upstairs), not just town-to-town travel — a stale location is worse than an over-reported one
- If a character doesn't move this scene, omit changes.location entirely — don't repeat their existing location
- Check each PC's 📍 line in PLAYER CHARACTERS below against where the scene_text actually puts them; if they differ, you missed a location update
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

  // Knowledge-relative sheet: what this character KNOWS and CAN DO.
  // Narration must respect these boundaries — see <capabilities> in the
  // system prompt.
  if (c.capabilities) {
    const cap = c.capabilities
    if (cap.known.length > 0) {
      parts.push(`Abilities: ${cap.known.map(k => `${k.name} (${k.band}, ${k.domain})`).join('; ')}`)
    }
    if (cap.glimpsed.length > 0) {
      parts.push(`Aware of but cannot do: ${cap.glimpsed.map(g => `${g.domain}${g.hint ? ` — ${g.hint}` : ''}`).join('; ')}`)
    }
    parts.push(`Systems this character knows exist: ${cap.knownDomains.length > 0 ? cap.knownDomains.join(', ') : 'NONE — they are ignorant of this world’s systems'}${c.origin_familiarity ? ` (origin: ${c.origin_familiarity.toLowerCase()})` : ''}`)
  }

  // Debt economy: open favors are live dramatic material — see <debts>.
  if (c.debts && (c.debts.owedByCharacter.length > 0 || c.debts.owedToCharacter.length > 0)) {
    const debtLines = [
      ...c.debts.owedByCharacter.map(d => `${c.name} owes ${d.counterparty} (${d.description})`),
      ...c.debts.owedToCharacter.map(d => `${d.counterparty} owes ${c.name} (${d.description})`),
    ]
    parts.push(`Debts: ${debtLines.join('; ')}`)
  }

  // Corruption: qualitative stage only — see <corruption>.
  if (c.corruption_status) {
    parts.push(`Corruption: ${c.corruption_status}`)
  }

  // Faction standing: qualitative social position — see <faction_standing>.
  if (c.standings && c.standings.length > 0) {
    parts.push(`Standing: ${c.standings.map(s => `${s.label} ${s.faction}`).join('; ')}`)
  }

  return `• ${parts.join('\n  ')}`
}).join('\n\n')}

IMPORTANT NPCs:
${world_summary.npcs.filter(n => n.importance >= 3).map(n => {
  // Only name the faction if it's in the discovered factions list — an
  // affiliation with a hidden faction stays out of the prompt entirely.
  const npcFaction = n.factionId ? world_summary.factions.find(f => f.id === n.factionId) : null
  const factionPart = npcFaction ? ` | ${npcFaction.name} (${n.factionRole === 'LEADER' ? 'leader' : 'member'})` : ''
  return `• ${n.name} - ${n.relationship || 'Neutral'} | Goals: ${n.goals || 'Unknown'} | Importance: ${n.importance}/5${factionPart}`
}).join('\n')}

FACTIONS:
${world_summary.factions.map(f => {
  const leader = f.leader_character_id
    ? world_summary.characters.find(c => c.id === f.leader_character_id)
    : null
  const leaderPart = leader ? ` | LED BY PLAYER CHARACTER: ${leader.name}` : ''
  return `• ${f.name} (threat: ${f.threat_level}, resources: ${f.resources}, influence: ${f.influence}) - ${f.goals || 'Unknown'} | Plan: ${f.currentPlan || 'Unknown'}${leaderPart}`
}).join('\n')}

${world_summary.wars && world_summary.wars.length > 0 ? `ACTIVE WARS (narrate from this real state — don't invent how a war is going):
${world_summary.wars.map(w => {
  const attackerSide = w.attacker_allies > 0 ? `${w.attacker} and ${w.attacker_allies} all${w.attacker_allies === 1 ? 'y' : 'ies'}` : w.attacker
  const defenderSide = w.defender_allies > 0 ? `${w.defender} and ${w.defender_allies} all${w.defender_allies === 1 ? 'y' : 'ies'}` : w.defender
  return `• ${w.name}: ${attackerSide} vs ${defenderSide} — currently ${w.momentum}, ${w.turns_elapsed} turn${w.turns_elapsed === 1 ? '' : 's'} in`
}).join('\n')}

` : ''}KNOWN LOCATIONS:
${world_summary.locations && world_summary.locations.length > 0
  ? world_summary.locations.map(l => {
    const owner = l.owner_faction_id ? world_summary.factions.find(f => f.id === l.owner_faction_id) : null
    const ownerPart = owner ? ` | Controlled by ${owner.name}${l.is_contested ? ' (CONTESTED)' : ''}` : ''
    return `• ${l.name}${l.type !== 'unknown' ? ` [${l.type}]` : ''}${l.description ? ` - ${l.description}` : ''}${l.weather ? ` | Weather: ${l.weather}${l.weather_severity ? ` (severity ${l.weather_severity}/5)` : ''} — reference this, don't invent different weather` : ''}${ownerPart}`
  }).join('\n')
  : '(none discovered yet)'}

CLOCKS:
${world_summary.clocks.map(cl =>
  `• ${cl.name} [${cl.current_ticks}/${cl.max_ticks}] - ${cl.description} | Consequence: ${cl.consequence}`
).join('\n')}

RECENT TIMELINE:
${world_summary.recent_timeline_events.slice(0, 5).map(e =>
  `• Turn ${e.turn_number}: ${e.title} - ${e.summary}`
).join('\n')}
${world_summary.quests && world_summary.quests.length > 0 ? `
ACTIVE QUESTS (open undertakings — advance or close these via quest_changes; don't re-register them):
${world_summary.quests.map(q =>
  `• ${q.name}: ${q.objective || q.description}${q.given_by ? ` (for ${q.given_by})` : ''}${q.recent_progress ? ` | Last progress: ${q.recent_progress}` : ''}`
).join('\n')}
` : ''}
${world_summary._campaignSummary ? `\n${world_summary._campaignSummary}\n` : ''}${world_summary.relevant_campaign_history && world_summary.relevant_campaign_history.length > 0 ? `
RELEVANT CAMPAIGN HISTORY (semantically retrieved past events — treat these as established fact and stay consistent with them; if a player asks about one, answer from here, don't improvise):
${world_summary.relevant_campaign_history.map(m =>
  `• Turn ${m.turn} [${m.importance}] ${m.title}: ${m.summary}`
).join('\n')}
` : ''}${world_summary.relevant_lore && world_summary.relevant_lore.length > 0 ? `
RELEVANT LORE (reference material the GM imported — treat this as canon for this world; draw on it for names, places, and details instead of inventing your own when it already covers the topic):
${world_summary.relevant_lore.map(l =>
  `• ${l.title}: ${l.content}`
).join('\n')}
` : ''}</world_state>

<current_scene>
${current_scene_intro}
</current_scene>

<player_actions>
${player_actions.map(a => {
  const lines = [`${a.character_name}: "${a.action_text}"`]
  if (a.mechanics) {
    lines.push(`  → MECHANICAL OUTCOME (binding, already rolled): ${a.mechanics.move_name} — ${a.mechanics.outcome === 'strongHit' ? 'STRONG HIT' : a.mechanics.outcome === 'weakHit' ? 'WEAK HIT' : 'MISS'}. ${a.mechanics.outcome_text}`)
    if (a.mechanics.corruption_surge) {
      lines.push(`  → CORRUPTION SURGE: this character ACCEPTED the open bargain — the borrowed power visibly fueled this attempt. Narrate it working, and report corruption_change marks 1 for them (see <corruption>).`)
    }
  }
  return lines.join('\n')
}).join('\n\n')}
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

3. scene_text AND world_updates MUST MATCH — never narrate a state change
   without also recording it, or vice versa:
   • If scene_text says a character was hit, wounded, or took a blow →
     pc_changes for that character needs harm_damage matching the severity
     (a graze is 1, a solid hit 2-3, something brutal or from a real
     threat higher). A MISS's "hard GM move" doesn't have to be harm, but
     if you narrate one, the harm_damage MUST be there — don't describe an
     injury that isn't on the sheet.
   • If scene_text puts a character somewhere new — even just another
     room, not only a new city — pc_changes.location must be set to
     match. Re-read your own scene_text before finalizing world_updates
     and check every PC's outcome against what you wrote.

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
  completedGoalNpcs: Array<{ npcId: string; npcName: string; completedGoal: string | number }> = [],
  pendingAmbitions: Array<{ factionId: string; factionName: string; goal: string; archetype: string; targetFactionName?: string }> = [],
  recentAmbitionNames: string[] = []
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
    location_changes?: AIGMResponse['world_updates']['location_changes']
  }
  // The flavor picked for each pendingAmbition — the tick already decided
  // WHETHER a faction commits to something big; this is only the WHAT.
  // category must be one of the bounded options given in the prompt for
  // that faction's goal; worldTurn.ts falls back to the deterministic
  // template for any faction this doesn't cover or picks outside the list.
  ambition_picks?: Array<{
    faction_id: string
    category: string
    name: string
    description?: string
  }>
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

  const ambitionNote = pendingAmbitions.length > 0
    ? `\n\nThese factions have committed enough resources to attempt something
major this turn. The commitment itself already happened — your only job is
picking WHAT it is:
${pendingAmbitions.map(a => `- ${a.factionName} (id: ${a.factionId}), pursuing ${a.goal}${a.targetFactionName ? ` against ${a.targetFactionName}` : ''}: choose one of [${AMBITION_CATEGORY_OPTIONS[a.archetype as keyof typeof AMBITION_CATEGORY_OPTIONS]?.[a.goal as 'ENRICH' | 'EXPAND' | 'DESTABILIZE_RIVAL']?.join(', ') || 'tournament, trade fair'}]`).join('\n')}
${recentAmbitionNames.length > 0
  ? `\nAvoid repeating or closely echoing anything already done recently: ${recentAmbitionNames.join(', ')}.`
  : ''}
For each one, include an ambition_picks entry with faction_id set to their id
above, category set to EXACTLY one of the options listed for them (not a
paraphrase), and a specific, setting-appropriate name that fits both the
faction's flavor and this world — a generic "${'{Faction}'} ${'{Category}'}" is the
deterministic fallback if you skip a faction, not a target to aim for.
Also include a matching offscreen event narrating it kicking off.`
    : ''

  const userPrompt = `World State Summary:
${JSON.stringify(worldSummary, null, 2)}

Clocks about to complete or recently advanced:
${JSON.stringify(clocksAboutToComplete, null, 2)}
${goalCompletionNote}${ambitionNote}

Generate 1-3 brief offscreen events that show villains/factions making moves.

If an event produces a lasting outcome — a named winner, a new rival, a
faction gaining or losing ground, a place worth remembering — record it in
world_updates so it becomes a real, persistent part of the world instead of
only existing in this summary text. Use npc_changes with is_new: true to
introduce anyone the event produces (a tournament winner, a new claimant,
a survivor) so they can be found and questioned later and will remember
what happened to them. Use location_changes with is_new: true if the event
happens somewhere specific and nameable (a villain's hideout, a ruin, a
new settlement) — this registers the place as existing in the world without
the party discovering it; they'll only learn of it by finding it in play.
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
    ],
    "location_changes": [
      {"name": "New Place Name", "is_new": true, "description": "What this place is, only if the event needs it on the record", "location_type": "hideout"}
    ]
  },
  "ambition_picks": [
    {"faction_id": "...", "category": "one of the exact options listed above for that faction", "name": "Setting-appropriate event name", "description": "1-2 sentences on what's happening"}
  ],
  "gm_notes": "Strategic notes about what's developing..."
}`

  try {
    const response = await openaiFetch('https://api.openai.com/v1/chat/completions', {
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
