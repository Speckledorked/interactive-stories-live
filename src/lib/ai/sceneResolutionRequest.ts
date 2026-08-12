// src/lib/ai/sceneResolutionRequest.ts
// Build a complete AI GM request for scene resolution: picks the right
// world-summary builder for the campaign's size, resolves action mechanics,
// retrieves campaign memory/lore, and assembles the corruption/safety
// context — everything buildSystemPrompt/buildUserPrompt (scenePrompt.ts)
// need to turn into the actual prompt sent to the model.

import { prisma } from '@/lib/prisma'
import { AIGMRequest } from './client'
import { ComplexExchangeResolver, NarrativeFlowManager } from '@/lib/game/complex-exchange-resolver' // Phase 16
import { retrieveRelevantHistory, retrieveNpcHistory, buildSearchQuery } from './memoryRetrieval' // Campaign Memory RAG
import { retrieveCrossEntityHistory, generateEntityPairs } from './crossEntityRecall'
import { retrieveRelevantLore, recordLoreCitations } from './loreRetrieval' // Imported lore RAG (see lib/lore/)
import { resolveActionMechanics } from '@/lib/game/resolution'
import { describeZone } from '@/lib/game/zones'
import { parseCorruptionTheme, describeCorruptionForPrompt } from '@/lib/game/corruption'
import { isEvolutionEligible } from '@/lib/game/advancement'
import { buildOptimizedWorldSummary, buildWorldSummaryForAI } from './worldSummary'
import { applyTokenBudget } from './tokenBudget'
import { parseSceneProgressState } from '@/lib/game/worldUpdaters/sceneProgress'

// Backstop: a real scene reported stuck at 60 exchanges despite
// scenePrompt.ts's urgent <pacing> tier being a "HARD REQUIREMENT" for
// every exchange since 15 — prose urging alone is not a guarantee the model
// actually complies, no matter how forcefully worded. Past this ceiling,
// force the same <scene_ending> treatment an explicit end-scene action
// already gets (a different, more binary framing: "this exchange ends the
// scene, period" rather than "resolve the central obstacle"), instead of
// trusting one more round of the same pacing text to finally land. Well
// above PACING_URGENT_THRESHOLD (15, scenePrompt.ts) so a scene gets a
// real chance to close on its own first.
export const SCENE_RUNAWAY_EXCHANGE_CEILING = 25

/**
 * Pure so the ceiling logic is testable without standing up this file's
 * whole DB-heavy request-building pipeline. An explicit end-scene request
 * always wins regardless of exchange count; otherwise, forces ending once
 * a scene has run far enough that pacing text alone has clearly failed.
 */
export function deriveEffectiveSceneEnding(
  isSceneEnding: boolean,
  currentExchange: number | null
): boolean {
  return isSceneEnding || (currentExchange ?? 0) >= SCENE_RUNAWAY_EXCHANGE_CEILING
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

/**
 * Build a complete AI GM request for scene resolution
 *
 * @param campaignId - Campaign ID
 * @param sceneId - Current scene ID
 * @returns Complete request object ready to send to AI
 */
export async function buildSceneResolutionRequest(
  campaignId: string,
  sceneId: string,
  isSceneEnding: boolean = false
): Promise<AIGMRequest> {
  console.log('🎬 Building scene resolution request')

  // Get campaign info
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId }
  })

  if (!campaign) {
    throw new Error('Campaign not found')
  }

  // Lines and veils (see lib/safety/safety-service.ts) — a plain findUnique,
  // not getCampaignSafety, so a campaign that's never touched its safety
  // settings doesn't get a settings row created as a side effect of playing.
  const safetySettings = await prisma.campaignSafetySettings.findUnique({
    where: { campaignId },
    select: { lines: true, veils: true },
  })

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

  const effectiveIsSceneEnding = deriveEffectiveSceneEnding(isSceneEnding, scene.currentExchange)

  // Split-party scoping: a scene the GM created for specific characters
  // (Character-Focused, or one half of a split party) carries that list
  // in participants — null means a genuinely open scene, which still sees
  // the full living roster exactly as before. See buildOptimizedWorldSummary's
  // doc comment for what this prevents (sibling concurrent scenes leaking
  // into each other's context).
  const participantCharacterIds: string[] | null = (scene.participants as any)?.characterIds ?? null

  // Phase 14.6: Use optimized context for campaigns with 10+ scenes
  const sceneCount = await prisma.scene.count({ where: { campaignId } })
  let worldSummary: AIGMRequest['world_summary']
  let entities: { characters: any[], npcs: any[], factions: any[] }

  if (sceneCount >= 10) {
    console.log('📉 Using optimized context (campaign has', sceneCount, 'scenes)')
    const result = await buildOptimizedWorldSummary(campaignId, scene.sceneNumber, participantCharacterIds)
    worldSummary = result.worldSummary
    entities = result.entities
  } else {
    console.log('📊 Using full context (campaign has', sceneCount, 'scenes)')
    const result = await buildWorldSummaryForAI(campaignId, participantCharacterIds)
    worldSummary = result.worldSummary
    entities = result.entities
  }

  // The mechanical spine: classify + server-roll every pending action in
  // this exchange BEFORE the narrator sees them, so outcome bands arrive
  // as binding constraints. Fails open to [] — freeform resolution.
  const pendingActions = scene.playerActions.filter(a => a.status === 'pending')
  const { mechanics: actionMechanics, classificationUnavailable } = await resolveActionMechanics(
    campaignId,
    sceneId,
    pendingActions.map(a => ({
      id: a.id,
      characterId: a.characterId,
      userId: a.userId,
      actionText: a.actionText
    }))
  )
  const mechanicsByActionId = new Map(actionMechanics.map(m => [m.actionId, m]))

  // Format player actions
  const playerActions = scene.playerActions.map(action => {
    const mechanics = mechanicsByActionId.get(action.id)
    return {
      character_name: action.character.name,
      character_id: action.character.id,
      action_text: action.actionText,
      ...(mechanics
        ? {
            mechanics: {
              move_name: mechanics.moveName,
              outcome: mechanics.outcome,
              outcome_text: mechanics.outcomeText,
              // Where the engine decided this character was standing when
              // they acted (#2/#43/#85). The dice already priced it; the
              // narrator gets it so the prose doesn't contradict a position
              // the roll charged for — a charge that earned +1 for closing
              // shouldn't be narrated from across the room.
              position: describeZone(mechanics.zonePosition),
              ...(mechanics.corruptionSurgeBonus > 0 ? { corruption_surge: true } : {})
            }
          }
        : {})
    }
  })

  // Phase 16.3: Check if this is a complex exchange (>3 actions)
  let exchangeGuidance = ''
  if (scene.playerActions.length > 3) {
    console.log('🔀 Complex exchange detected - generating narrative sequence')
    const resolver = new ComplexExchangeResolver(campaignId, sceneId)
    const complexExchange = await resolver.resolveComplexExchange(mechanicsByActionId)

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
    // A fixed 2-exchange window used to sit here (comment: "OPTIMIZATION:
    // only include the last 2 exchanges to prevent prompt bloat"). That was
    // the actual root cause a player once reported ("I keep saying 'I
    // comply' ... and it's just more of the same" — see scenePrompt.ts's
    // PACING_NUDGE_THRESHOLD comment): with a scene's own earlier exchanges
    // gone from the prompt after just 2 more happened, the narrator had no
    // way to know it had already established a fact and would re-explain it
    // in slightly different words. Widened to 6 as a mitigation, which
    // helped the symptom but — as documented at the time — never fixed the
    // named cause: the model was still reconstructing "what's already
    // established" purely by re-reading prose.
    //
    // Now narrowed back to 3: the scene progress ledger below
    // (buildSceneProgressLedger, fed by Scene.progressState) is what
    // actually carries "already established/resolved" forward explicitly,
    // so raw prose no longer has to do that job by being wide enough to
    // not scroll a fact out of view — it only needs to carry recent tone
    // and phrasing for continuity of voice. Cheaper AND more reliable than
    // the wider window, not a tradeoff between them.
    // Split by the separator used when appending resolutions
    const allResolutions = scene.sceneResolutionText.split('\n\n---\n\n')
    const recentResolutions = allResolutions.slice(-3)

    if (recentResolutions.length > 0) {
      sceneContext += '\n\n## What Has Happened Recently:\n\n' + recentResolutions.join('\n\n---\n\n')
    }
  }

  // Scene progress ledger: explicit "already established/resolved" state,
  // read back so the model stops re-deriving it from the (now-narrower)
  // raw prose window above. See worldUpdaters/sceneProgress.ts.
  const progressState = parseSceneProgressState(scene.progressState)
  const hasProgressLedger =
    progressState.establishedFacts.length > 0 ||
    progressState.resolvedBeats.length > 0 ||
    progressState.activeConflict !== null ||
    Object.keys(progressState.npcIntentions).length > 0 ||
    progressState.recentMoves.length > 0
  const sceneProgressLedger = hasProgressLedger
    ? {
        established_facts: progressState.establishedFacts,
        resolved_beats: progressState.resolvedBeats.map((b) => b.text),
        active_conflict: progressState.activeConflict,
        npc_intentions: Object.entries(progressState.npcIntentions).map(([npc, intention]) => ({ npc, intention })),
        recent_moves: progressState.recentMoves,
      }
    : undefined

  // RAG Memory Retrieval: Get relevant campaign history
  // OPTIMIZATION: Reuse entities already fetched in world summary to avoid duplicate queries
  //
  // The search query text is built once here and reused by both memory and
  // lore retrieval below (previously each built its own copy from the same
  // context — buildSearchQuery is pure, so that was recomputation, not a
  // behavior difference). Same scene-context query text either way, so a
  // query naming an NPC or location matches lore about it the same way it
  // matches history.
  const searchQuery = buildSearchQuery({
    currentScene: scene,
    playerActions: scene.playerActions,
    characters: entities.characters,
    npcs: entities.npcs,
    factions: entities.factions,
  })

  let relevantMemories: any[] = []
  try {
    console.log('🧠 Retrieving relevant campaign memories...')

    // Use already-fetched entities from world summary build (no duplicate DB queries!)
    const { characters, npcs, factions } = entities

    // Retrieve memories with the pre-fetched entities
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
      },
      searchQuery
    )

    console.log(`✅ Retrieved ${relevantMemories.length} relevant memories`)
  } catch (memoryError) {
    const errorMsg = memoryError instanceof Error ? memoryError.message : String(memoryError)
    console.error('⚠️ Memory retrieval failed:', errorMsg)
    // Log but continue - scene resolution can work without memories if needed
  }

  // Imported Lore Retrieval: search any pasted/URL/wiki lore the GM has
  // imported (see lib/lore/) for what's relevant to this scene.
  let relevantLore: any[] = []
  try {
    relevantLore = await retrieveRelevantLore(campaignId, searchQuery, { maxEntries: 5, minSimilarity: 0.75 })
    if (relevantLore.length > 0) {
      console.log(`📚 Retrieved ${relevantLore.length} relevant lore entries`)
      // Best-effort citation trail — never lets a write failure affect the
      // request being built (see recordLoreCitations' own doc comment).
      await recordLoreCitations(campaignId, sceneId, relevantLore)
    }
  } catch (loreError) {
    console.error('⚠️ Lore retrieval failed:', loreError instanceof Error ? loreError.message : String(loreError))
    // Log but continue - scene resolution can work without imported lore
  }

  // Guaranteed recall: if the player's action text names an NPC directly,
  // pull that NPC's own history instead of hoping semantic search surfaces
  // it. entities.npcs is the campaign's full NPC list (not the "nearby or
  // important" filtered set used elsewhere) so this works regardless of
  // whether the named NPC is currently on-screen or minor.
  try {
    const actionText = scene.playerActions.map(a => a.actionText).join(' ').toLowerCase()
    // Fog of war: only DISCOVERED entities qualify for name-mention recall.
    // entities.* is the full unfiltered campaign list (that's what the
    // recall guarantee needs for entities the party HAS met, regardless of
    // current scene relevance) — but a player typing an undiscovered
    // entity's exact name must not pull its hidden history into the prompt.
    const mentionedNpcIds = entities.npcs
      .filter(n => n.isDiscovered && n.name && actionText.includes(n.name.toLowerCase()))
      .map(n => n.id)

    if (mentionedNpcIds.length > 0) {
      const existingIds = new Set(relevantMemories.map((m: any) => m.id))
      const namedMemories = (
        await Promise.all(mentionedNpcIds.map(id => retrieveNpcHistory(campaignId, id, 5)))
      ).flat().filter(m => !existingIds.has(m.id))

      if (namedMemories.length > 0) {
        console.log(`🎯 Named-NPC recall: added ${namedMemories.length} memor(ies) for explicitly mentioned NPC(s)`)
        relevantMemories = [...relevantMemories, ...namedMemories]
      }
    }

    // Cross-entity recall: "what happened between X and Y" — if the action
    // names two or more entities (NPCs and/or factions) at once, pull
    // memories where BOTH appear, not just each one's own history. This is
    // an intersection the per-entity recall above can't produce: a player
    // asking an NPC about their history with a faction, or referencing two
    // NPCs' shared past, needs the memory that mentions both, which could
    // easily be outranked by unrelated single-entity memories otherwise.
    const mentionedFactionIds = entities.factions
      .filter(f => f.isDiscovered && f.name && actionText.includes(f.name.toLowerCase()))
      .map(f => f.id)
    const mentionedEntityIds = Array.from(new Set([...mentionedNpcIds, ...mentionedFactionIds]))

    if (mentionedEntityIds.length >= 2) {
      const pairs = generateEntityPairs(mentionedEntityIds)
      const existingIds = new Set(relevantMemories.map((m: any) => m.id))
      const crossEntityMemories = (
        await Promise.all(pairs.map(([a, b]) => retrieveCrossEntityHistory(campaignId, a, b, 3)))
      ).flat().filter(m => !existingIds.has(m.id))

      if (crossEntityMemories.length > 0) {
        console.log(`🔗 Cross-entity recall: added ${crossEntityMemories.length} memor(ies) shared between mentioned entities`)
        relevantMemories = [...relevantMemories, ...crossEntityMemories]
      }
    }
  } catch (namedRecallError) {
    console.error('⚠️ Named NPC recall failed:', namedRecallError)
  }

  // Add memories and imported lore to world summary
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
    relevant_lore: relevantLore.map(l => ({
      title: l.title,
      content: l.content,
      relevance: Math.round(l.similarity * 100) + '%',
    })),
  }

  // Enhance system prompt with memory instructions
  const enhancedSystemPrompt = enhanceSystemPromptWithMemory(
    campaign.aiSystemPrompt,
    relevantMemories.length > 0
  )

  // Corruption: attach the campaign's theme (gates the <corruption> prompt
  // section) and each character's qualitative stage. The summary builders
  // don't carry raw corruption values, but entities.characters are the
  // unfiltered rows — match by id. No theme = the track doesn't exist here.
  const corruptionTheme = parseCorruptionTheme(campaign.corruptionTheme)
  let corruptionThemeForPrompt: AIGMRequest['corruption_theme'] = corruptionTheme
  if (corruptionTheme) {
    for (const summaryCharacter of worldSummaryWithMemories.characters as any[]) {
      const raw = entities.characters.find((rc: any) => rc.id === summaryCharacter.id)
      if (raw && raw.corruption > 0) {
        summaryCharacter.corruption_status = describeCorruptionForPrompt(corruptionTheme, raw.corruption)
      }
    }

    // Shadow arts: the forbidden branch of the capability tree. Listed in
    // the <corruption> section so the AI knows which arts resist the
    // unmarked (the engine enforces the gate either way).
    const shadowNodes = await prisma.campaignCapability.findMany({
      where: { campaignId: campaign.id, isShadow: true },
      select: { name: true, domain: true, tier: true },
    })
    if (shadowNodes.length > 0) {
      corruptionThemeForPrompt = {
        ...corruptionTheme,
        shadow_arts: shadowNodes.map(n => ({
          name: n.name,
          domain: n.domain,
          required_marks: Math.max(1, n.tier),
        })),
      }
    }
  }

  // Stress-driven evolution eligibility (lib/game/stress.ts +
  // advancement.ts's isEvolutionEligible) — independent of corruption
  // theme, so computed unconditionally. Never attaches the raw stress
  // number itself, only the boolean the AI is allowed to act on.
  const worldMeta = await prisma.worldMeta.findUnique({
    where: { campaignId: campaign.id },
    select: { currentTurnNumber: true },
  })
  const currentTurnNumber = worldMeta?.currentTurnNumber ?? 0
  for (const summaryCharacter of worldSummaryWithMemories.characters as any[]) {
    const raw = entities.characters.find((rc: any) => rc.id === summaryCharacter.id)
    if (raw && isEvolutionEligible(raw.stress ?? 0, raw.advancementLog, currentTurnNumber)) {
      summaryCharacter.evolution_eligible = true
    }
  }

  // #117: a real token-budget check on top of the fixed entity-count caps
  // and per-string clamp already applied above — trims whole sections in
  // priority order only if the assembled request is actually over budget.
  const budgeted = applyTokenBudget({
    worldSummary: worldSummaryWithMemories,
    currentSceneIntro: sceneContext,
    participantCharacterIds,
  })
  if (budgeted.stepsApplied.length > 0) {
    console.log(`✂️ Token budget trimmed: ${budgeted.stepsApplied.join(', ')}`)
  }

  return {
    campaign_universe: campaign.universe || 'Generic Fantasy',
    ai_system_prompt: enhancedSystemPrompt + (fullGuidance ? `\n\n${fullGuidance}` : ''),
    world_summary: budgeted.worldSummary,
    current_scene_intro: budgeted.currentSceneIntro,
    corruption_theme: corruptionThemeForPrompt,
    safety_lines: safetySettings?.lines ?? [],
    safety_veils: safetySettings?.veils ?? [],
    player_actions: playerActions,
    action_mechanics: actionMechanics,
    current_exchange_number: scene.currentExchange ?? 0,
    scene_stakes: scene.stakes,
    is_scene_ending: effectiveIsSceneEnding,
    scene_progress_ledger: sceneProgressLedger,
    last_progress_exchange: progressState.lastProgressExchange,
    _mechanicsUnavailable: classificationUnavailable
  }
}
