import { openaiFetch } from '@/lib/ai/openaiCompat'
// src/lib/ai/client.ts
// OpenAI client wrapper
// This handles all communication with the AI model
// Phase 15: Enhanced with strict validation, error handling, and cost tracking

import { callChatCompletion } from './chatCompletion'
import { buildSystemPrompt, buildUserPrompt } from './scenePrompt'
import { validateAIResponseWithRepair, addValidationMetadata } from './validation'
import { checkOutcomeAdherence, type OutcomeBand, type AdherenceResult } from '@/lib/game/outcomeAdherence'
import { repairUnreportedAdherence } from './outcomeEchoRepair'
import { validateWorldTurnResponse } from './validation'
import { circuitBreakerManager } from './circuit-breaker'
import { AICostTracker, estimateTokenCount, recordAICost } from './cost-tracker'
import { AI_MODELS } from './models'
import { AMBITION_CATEGORY_OPTIONS } from '@/lib/game/tick/ambitionTick'
import type { SceneProgress } from './schema'

// Re-exported for existing importers — buildSystemPrompt/buildUserPrompt now
// live in scenePrompt.ts, broken into one function/constant per <tag>
// section (see that file's header comment).
export { buildSystemPrompt, buildUserPrompt }

// Purely informational chatter (prompt lengths, "call succeeded", which
// model served the request) — useful while developing, just noise in
// production logs. Actual problems (parse failures, degraded validation,
// circuit breaker trips) stay on console.error/warn unconditionally so
// they still surface in prod log aggregators.
const devLog = process.env.NODE_ENV === 'production' ? (..._args: unknown[]) => {} : console.log

/**
 * AI GM Response Structure
 * This is what we expect back from the AI after resolving a scene
 */
export interface AIGMResponse {
  scene_text: string // The narrated resolution
  // A genuine 1-2 sentence past-tense recap of what happened this scene —
  // not the same text as scene_text. Feeds the Story Log/campaign history
  // view (generateCampaignLog in sceneResolver.ts).
  scene_summary?: string
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
  // Scene progress ledger (see prisma/schema.prisma's Scene.progressState
  // and lib/game/worldUpdaters/sceneProgress.ts) — what this exchange
  // established/resolved, and the scene's current active conflict/NPC
  // intentions. Applied by sceneResolver.ts alongside world_updates, not
  // inside applyWorldUpdates's transaction — it's scene-level bookkeeping,
  // not an entity-state write.
  scene_progress?: SceneProgress
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
        harm_healing?: number
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
          // Enforced counterparts to the free text above (#88) — see
          // lib/game/harm.ts.
          harmPerScene?: number
          statModifiers?: { cool?: number; hard?: number; hot?: number; sharp?: number; weird?: number }
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
          // 'debt' is an alias, not a consequence array: it's routed into
          // the real Debt model (see debtChangeFromConsequence, #69), which
          // is why the three fields below exist. Nothing is written to
          // consequences.debts.
          type: 'promise' | 'debt' | 'enemy' | 'longTermThreat'
          description: string
          counterparty_name?: string
          counterparty_type?: 'npc' | 'faction'
          direction?: 'owed_by_character' | 'owed_to_character'
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
        }
        // Resource changes. Faction reputation is tracked through
        // standing_changes (a real, roll-feeding number), not here —
        // don't invent a separate reputation field.
        resource_changes?: {
          gold_delta?: number // +/- gold
          contacts_add?: string[]
          contacts_remove?: string[]
        }
        // Someone treats a Taken Out (harm 6) character's wounds
        medical_attention?: {
          skill: 'basic' | 'trained' | 'expert'
          has_supplies: boolean
        }
        // A stretch of real rest the fiction gave them, graded by shelter
        rest_quality?: 'poor' | 'adequate' | 'excellent'
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
            // Worth and scarcity — both mechanically read, see itemValue.ts.
            value?: number
            rarity?: 'common' | 'uncommon' | 'rare' | 'legendary'
          }>
          standing_changes?: Array<{ faction_name: string; delta: number; reason: string }>
          // The faction footing the bill, if one is. Makes the payout a
          // real transfer out of that faction's resources — see
          // lib/game/factionPayout.ts.
          paid_by_faction?: string
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

// PbtA stat block — see prisma/schema.prisma's Character.stats column
// comment for the canonical shape this is read from ({cool, hard, hot,
// sharp, weird}, each -1..3). Partial because a freshly-created character
// can have any subset unset.
type CharacterStatBlock = Partial<Record<'cool' | 'hard' | 'hot' | 'sharp' | 'weird', number>>

// Per-NPC/faction rapport, keyed by entity id — see
// prisma/schema.prisma's Character.relationships column comment, and
// RelationshipForRoll in lib/game/resolution.ts which reads this same shape
// off the DB record to compute relationshipModifier.
type CharacterRelationshipMap = Record<string, { trust: number; tension: number; respect: number; fear: number }>

// See prisma/schema.prisma's Character.consequences column comment.
interface CharacterConsequences {
  promises?: string[]
  debts?: string[]
  enemies?: string[]
  longTermThreats?: string[]
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
    // #118: derived from the campaign's calendar (tick/seasonTick.ts /
    // lib/game/calendar.ts's deriveSeason) — narration flavor, alongside
    // (not instead of) the mechanical resource-regen/clock-speed knobs the
    // same derived season also drives.
    season?: string
    characters: Array<{
      id: string
      name: string
      description: string | null
      // Permanent/lasting changes the fiction has already written onto
      // this character (scars, mutations, trauma, growth) — see
      // pc_changes.appearance_changes/personality_changes below.
      appearance: string | null
      personality: string | null
      stats: CharacterStatBlock | null
      backstory: string | null
      goals: string | null
      location: string | null
      relationships?: CharacterRelationshipMap | null
      consequences?: CharacterConsequences | null
      // Current mechanical state (harm.ts) — the raw Character.harm/
      // conditions fields, passed through untyped-in-detail on purpose
      // (this prompt only ever reads them via parseHarmState/getHarmStatus,
      // never assumes a shape directly). Previously present in the mapped
      // data but never actually rendered anywhere in the prompt — the
      // narrator had no structural way to know a condition was still
      // active except by re-reading its own recent prose, exactly the
      // fragile pattern the Scene Progress Ledger replaced for scene
      // continuity. See buildCharactersSection.
      harm?: number | null
      conditions?: unknown
      // Knowledge-relative sheet (see lib/game/capabilities.ts): what this
      // character knows exists and can do — qualitative bands only.
      origin_familiarity?: string
      capabilities?: {
        known: Array<{ name: string; domain: string; band: string; description: string | null }>
        glimpsed: Array<{ domain: string; hint: string | null }>
        knownDomains: string[]
      }
      // Structured, permanent declarative knowledge (#173/#174) — distinct
      // from capabilities above. See lib/game/knowledge.ts.
      known_concepts?: Array<{ key: string; label: string; learnedAt: number; source?: string }>
      // Information Latency (#101) — THIS character's own knowledge of
      // significant world events, linked back to real WorldEvent rows
      // (unlike known_concepts, which is free-text and AI-declared).
      // Witnessed = present when it happened, ground truth. Told = heard
      // secondhand, rumor-grade. See lib/game/eventWitness.ts.
      witnessed_events?: string[]
      told_events?: string[]
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
      // True when accumulated stress (lib/game/stress.ts) plus available
      // perk/move arc budget make a perk/move evolution offer eligible
      // this scene — see advancement.ts's isEvolutionEligible. Never the
      // raw stress number.
      evolution_eligible?: boolean
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
      // PbtA GM-facing flavor for a significant NPC — only set when the
      // NPC actually has one (see npcFlavorFields in worldState.ts).
      threat?: string
      impulses?: string[]
      moves?: string[]
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
      // Where the engine had this character standing when they acted, in
      // the fiction's own words (see lib/game/zones.ts). The roll already
      // charged for it; this keeps the prose consistent with what was
      // charged for.
      position?: string
      // True when this roll was powered by accepting an open corruption
      // bargain — narrate the borrowed power working, and the price.
      corruption_surge?: boolean
    }
  }>
  // Full roll records for this exchange, carried through so the resolver
  // can store receipts — not rendered into the prompt directly.
  action_mechanics?: import('@/lib/game/resolution').ActionMechanics[]
  // Which exchange of THIS scene this is (scene.currentExchange) — gates
  // <pacing> in scenePrompt.ts. The model only ever sees a bounded recent
  // window of prose (see sceneResolutionRequest.ts's recentResolutions
  // cap), so without this number it has no way to notice a scene has run
  // unusually long and keeps meeting cooperation with a fresh complication
  // instead of ever letting a thread resolve.
  current_exchange_number?: number
  // What's at risk in this scene (Scene.stakes — generated once at scene
  // creation, see sceneStakes.ts). Gives the model a concrete target to
  // resolve against instead of an abstract "wrap it up," and is echoed in
  // <scene_ending> below when this is the scene's definitive final exchange.
  scene_stakes?: string | null
  // Set when this exchange is the scene's definitive end (see
  // resolveScene's isSceneEnding param and end-scene/route.ts) — not merely
  // "pacing suggests wrapping up," but "this scene ends now regardless."
  // Drives <scene_ending> in scenePrompt.ts.
  is_scene_ending?: boolean
  // The scene progress ledger, read back into the prompt (see
  // prisma/schema.prisma's Scene.progressState and
  // worldUpdaters/sceneProgress.ts) — an explicit, bounded record of
  // what's already established/resolved/in-play, instead of the model
  // re-deriving it from raw prose. Undefined for a scene's first exchange
  // (nothing to report yet) or one created before this existed.
  scene_progress_ledger?: {
    established_facts: string[]
    resolved_beats: string[]
    active_conflict: string | null
    npc_intentions: Array<{ npc: string; intention: string }>
    // #232: moves already used earlier in this scene (WEAK HIT/MISS menu
    // phrases, most-recent-last, bounded — see moveVariety.ts's
    // MAX_RECENT_MOVES), read back into buildMechanicalOutcomesSection as
    // a soft "avoid repeating" nudge instead of a generic instruction
    // repeated identically every exchange.
    recent_moves: string[]
  }
  // The exchange number scene_progress_ledger's state last actually
  // changed (a new beat, or active_conflict genuinely updating) — see
  // SceneProgressState.lastProgressExchange. buildPacingSection compares
  // this against current_exchange_number to detect a real stall (no
  // progress for N exchanges) instead of only ever reacting to raw
  // exchange count, which gives zero pressure at all before exchange 8
  // regardless of how stuck a scene already is.
  last_progress_exchange?: number
  // #200: an internal, never-AI-facing signal (same "underscore-prefixed,
  // ignored by the prompt builder" convention as the AI response's own
  // _outcomeAdherence) — true when this exchange had pending actions but
  // the dice engine failed to produce mechanics for any of them (missing
  // OPENAI_API_KEY, an OpenAI outage, or an unexpected error in
  // resolveActionMechanics). The scene still resolves freeform either
  // way; this is what lets the caller persist a visible "mechanics were
  // unavailable this exchange" signal instead of the failure being
  // indistinguishable from "nothing needed rolling."
  _mechanicsUnavailable?: boolean
}

// Prompt-caching params for a scene-resolution call. Scoped per campaign,
// not per scene: the system prompt (role/rules/mechanics/response format/
// etc., see scenePrompt.ts) is otherwise byte-identical for the campaign's
// entire lifetime, and it's the large majority of the input tokens on
// every call — sharing one cache lineage per campaign is what lets exchange
// 2+ of a scene, and every scene after the first, actually hit it. '24h' is
// the longest retention gpt-5.4/gpt-5.4-mini support, so a player returning
// the next day still gets a hit, not just back-to-back exchanges in one
// sitting. A miss just falls back to today's full-price behavior — no
// downside to requesting it on every call.
function cacheParams(campaignId?: string): { prompt_cache_key?: string; prompt_cache_retention?: string } {
  return campaignId
    ? { prompt_cache_key: `campaign-${campaignId}`, prompt_cache_retention: '24h' }
    : {}
}

/**
 * One real attempt at the AI GM call against a specific model — the whole
 * body callAIGM used to be, before #116 made the model a parameter instead
 * of a hardcoded AI_MODELS.FLAGSHIP. Not exported: callAIGM below is the
 * only entry point, and owns the fallback-chain decision of which model(s)
 * to try this function against.
 */
async function attemptAIGM(
  request: AIGMRequest,
  model: string,
  campaignId?: string,
  sceneId?: string,
  options?: {
    debugMode?: boolean
  }
): Promise<AIGMResponse & { _outcomeAdherence?: AdherenceResult }> {
  const startTime = Date.now()
  const apiKey = process.env.OPENAI_API_KEY

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured')
  }

  // Build the full prompt for the AI
  const systemPrompt = buildSystemPrompt(request)
  const userPrompt = buildUserPrompt(request)

  devLog('🤖 Calling AI GM...')
  devLog('System prompt length:', systemPrompt.length)
  devLog('User prompt length:', userPrompt.length)

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
        model, // #116: FLAGSHIP on the primary attempt, EFFICIENT on the one fallback attempt (see callAIGM)
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
        response_format: { type: 'json_object' }, // Request JSON response
        ...cacheParams(campaignId)
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

    devLog('✅ AI GM response received')
    devLog('Response length:', content.length)

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
            model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
              { role: 'assistant', content },
              { role: 'user', content: repairPrompt }
            ],
            temperature: 0.7,
            max_tokens: 4000,
            response_format: { type: 'json_object' },
            ...cacheParams(campaignId)
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
          const repairCostTracker = new AICostTracker(campaignId, model)
          await repairCostTracker.recordRequest({
            inputTokens: repairUsage.prompt_tokens || estimateTokenCount(systemPrompt + userPrompt + content + repairPrompt),
            outputTokens: repairUsage.completion_tokens || estimateTokenCount(repairContent),
            responseTimeMs: Date.now() - repairStartTime,
            success: true,
            cachedInputTokens: repairUsage.prompt_tokens_details?.cached_tokens || 0,
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

    // Stamp how intact this response was onto the response itself, so the
    // degradation level travels with it instead of living only in a
    // console line. It is what the AI-consistency health metric reads
    // below, and it is available to anything downstream that wants to be
    // honest with the player about a scene resolved from partial output.
    const validatedResponse = addValidationMetadata(
      validationResult.data as AIGMResponse,
      validationResult.level
    )

    // Log validation level
    if (validationResult.level === 'partial') {
      console.warn('⚠️ Using partial AI response - some world updates may be missing')
    } else if (validationResult.level === 'emergency') {
      console.warn('⚠️ Using emergency fallback template')
    } else {
      devLog('✅ Full AI response validation passed')
    }

    // Outcome adherence (#93): did the prose obey the dice? The engine
    // rolled these bands and told the narrator they were binding; this is
    // the first thing that checks whether that held. Deliberately only
    // observed — never rewrites the scene, never fails the turn — because
    // the gap being closed is that nothing MEASURED it, and a constraint
    // nobody measures is a request.
    let adherence = checkOutcomeAdherence(
      (request.player_actions ?? [])
        .filter(a => a.mechanics?.outcome)
        .map(a => ({ characterName: a.character_name, outcome: a.mechanics!.outcome as OutcomeBand })),
      (validatedResponse as { outcome_echo?: unknown }).outcome_echo
    )

    // Backstop for the unreported case specifically: one small follow-up
    // call per unreported roll, asking the model which band its own prose
    // actually depicted. Never blocks or delays the scene otherwise — a
    // failed backfill just leaves those entries unreported, same as
    // before this existed. See outcomeEchoRepair.ts.
    if (campaignId && adherence.unreported > 0) {
      adherence = await repairUnreportedAdherence(campaignId, validatedResponse.scene_text, adherence)
    }

    if (adherence.mismatched > 0) {
      console.warn(`⚖️ Narration contradicted the roll on ${adherence.mismatched} action(s):`)
      for (const problem of adherence.problems) console.warn(`  - ${problem}`)
    } else if (adherence.unreported > 0) {
      devLog(`⚖️ ${adherence.unreported} rolled action(s) not reported back by the narrator`)
    }

    // Phase 15.3: Record success in circuit breaker
    if (campaignId) {
      circuitBreakerManager.getBreaker(campaignId).recordSuccess()
    }

    // Phase 15.5.1: Track costs
    if (campaignId) {
      const costTracker = new AICostTracker(campaignId, model)
      await costTracker.recordRequest({
        inputTokens: usage.prompt_tokens || estimatedInputTokens,
        outputTokens: usage.completion_tokens || estimateTokenCount(content),
        responseTimeMs: Date.now() - startTime,
        success: true,
        // A response that fell through to a template is not a successful
        // resolution in any sense a GM would recognise, and recording it
        // as one is why AI consistency could read 100 on a campaign whose
        // model had stopped producing usable output.
        validationLevel: validationResult.level,
        // #93: recorded alongside the validation level so campaign health
        // can see a narrator that stops honoring outcomes — the same
        // reasoning as validationLevel itself, one layer up. A response can
        // be perfectly well-formed and still ignore every roll in it.
        outcomeMismatches: adherence.mismatched,
        outcomeChecked: adherence.matched + adherence.mismatched,
        cachedInputTokens: usage.prompt_tokens_details?.cached_tokens || 0,
        sceneId,
        requestType: 'scene_resolution'
      })
    }

    // Stamp the adherence result onto the response, the same convention
    // addValidationMetadata uses above, so sceneResolver.ts can persist it
    // per-exchange for the transparency panel (#91) without recomputing the
    // comparison a second time from aiRequest/aiResponse.
    return { ...validatedResponse, _outcomeAdherence: adherence }

  } catch (error) {
    const responseTimeMs = Date.now() - startTime
    console.error('❌ AI GM call failed:', error)

    // Record failure in cost tracker
    if (campaignId) {
      const costTracker = new AICostTracker(campaignId, model)
      await costTracker.recordRequest({
        inputTokens: estimatedInputTokens,
        outputTokens: 0,
        responseTimeMs,
        success: false,
        sceneId,
        requestType: 'scene_resolution'
      }).catch(console.error)
    }

    throw error
  }
}

/**
 * Call the OpenAI API with a structured prompt.
 * Phase 15: validation, caching, circuit breaker, and cost tracking.
 * #116: a multi-model fallback chain — AI_MODELS.FLAGSHIP first, then one
 * fallback attempt against AI_MODELS.EFFICIENT if the primary attempt hard-
 * fails OR the circuit breaker is already open for this campaign. Never
 * chained further: a fallback failure surfaces to the caller exactly like
 * today's single-model failure did.
 *
 * #230: `request` is reused byte-identical across both attempts — no
 * model-aware re-trimming happens here, on purpose. See
 * tokenBudget.ts's DEFAULT_TOKEN_BUDGET comment for why that's safe (same-
 * generation mini variants share their flagship's context window).
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
): Promise<AIGMResponse & { _outcomeAdherence?: AdherenceResult }> {
  // Phase 15.3: an open circuit skips straight to the fallback attempt
  // instead of refusing the call outright — the breaker tracks overall
  // AI-request health for this campaign, not FLAGSHIP specifically, so a
  // cheaper attempt is still worth one try before giving up entirely.
  const circuitOpen = campaignId ? !(await circuitBreakerManager.ensureHydrated(campaignId)).canAttempt() : false

  if (!circuitOpen) {
    try {
      const result = await attemptAIGM(request, AI_MODELS.FLAGSHIP, campaignId, sceneId, options)
      devLog(`✅ Served by ${AI_MODELS.FLAGSHIP}`)
      return result
    } catch (primaryError) {
      console.error(`⚠️ ${AI_MODELS.FLAGSHIP} call failed — falling back to ${AI_MODELS.EFFICIENT}:`, primaryError)
    }
  } else {
    console.error(`🚫 Circuit breaker OPEN for campaign ${campaignId} — skipping ${AI_MODELS.FLAGSHIP}, trying ${AI_MODELS.EFFICIENT} as a fallback`)
  }

  const fallbackResult = await attemptAIGM(request, AI_MODELS.EFFICIENT, campaignId, sceneId, options)
  devLog(`✅ Served by fallback model ${AI_MODELS.EFFICIENT}`)
  return fallbackResult
}

// buildSystemPrompt moved to scenePrompt.ts (broken into one function/
// constant per <tag> section) and re-exported below for existing callers.

// buildUserPrompt moved to scenePrompt.ts alongside buildSystemPrompt.

/**
 * Simpler AI call for background world turns
 * This generates offscreen events when no players are involved
 */
export async function callAIForWorldTurn(
  campaignUniverse: string,
  aiSystemPrompt: string,
  worldSummary: AIGMRequest['world_summary'],
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
    const result = await callChatCompletion({
      apiKey,
      model: AI_MODELS.EFFICIENT, // Cost optimization: efficient model for background world turns
      systemPrompt,
      userPrompt,
      temperature: 0.75, // Balanced creativity
      maxTokens: 1000, // Brief offscreen events (cost optimization)
      jsonMode: true,
    })

    if (!result.ok) {
      throw new Error(`OpenAI API error: ${result.status}`)
    }

    const content = result.content

    if (campaignId) {
      await recordAICost({
        campaignId,
        model: AI_MODELS.EFFICIENT,
        requestType: 'offscreen_events',
        inputTokens: result.usage.prompt_tokens || estimateTokenCount(systemPrompt + userPrompt),
        outputTokens: result.usage.completion_tokens || estimateTokenCount(content),
        responseTimeMs: Date.now() - startTime,
        success: true
      }).catch(console.error)
    }

    // Validate rather than trusting the parse. This response feeds the same
    // applyWorldUpdates writer scene resolution uses, so an unvalidated
    // npc_changes/faction_changes entry here would bypass every bound the
    // main contract enforces. Degrades to narrative-only (dropping the
    // state-mutating halves) before giving up entirely — see
    // validateWorldTurnResponse.
    const parsed = JSON.parse(content)
    const validation = validateWorldTurnResponse(parsed)

    if (validation.level === 'none') {
      console.error(
        'World turn response failed validation entirely; skipping this turn\'s offscreen events.',
        validation.error.errors.slice(0, 3)
      )
      return {
        offscreen_events: [],
        gm_notes: 'World turn response failed validation - offscreen events skipped'
      }
    }

    return validation.data
  } catch (error) {
    console.error('World turn AI call failed:', error)
    // Return empty result rather than crashing
    return {
      offscreen_events: [],
      gm_notes: 'AI call failed - world turn skipped'
    }
  }
}
