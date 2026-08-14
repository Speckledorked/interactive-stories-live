// src/lib/ai/worldSummary.ts
// Convert database records into a clean, AI-readable world_summary — the
// two builders (a relevance-filtered one for large campaigns, a full one
// for small campaigns), moved out of worldState.ts's original single file.

import { prisma } from '@/lib/prisma'
import { AIGMRequest } from './client'
import { buildOptimizedContext, capForPrompt, clampPromptStrings } from './contextManager' // Phase 14.6: Context optimization
import { describeTension, derivePhase } from '@/lib/game/tick/tension'
import { GeneratedCalendar, deriveSeason } from '@/lib/game/calendar'
import {
  MAX_NPCS_IN_PROMPT,
  MAX_FACTIONS_IN_PROMPT,
  MAX_QUESTS_IN_PROMPT,
  mapCharactersForPrompt,
  mapNpcsForPrompt,
  mapFactionsForPrompt,
  mapLocationsForPrompt,
  mapClocksForPrompt,
  mapQuestsForPrompt,
  mapWarsForPrompt,
} from './worldSummaryMappers'
import { groupEventWitnessesForPrompt, GroupedWitness } from '@/lib/game/eventWitness'

// Information Latency (#101) — a query-cost bound only, not a correctness
// one (the per-character MAX_WITNESSED/TOLD caps in eventWitness.ts do the
// actual trimming): keeps this from being an unbounded range scan in a
// very long campaign. Comfortably larger than tickInformation's own
// PROPAGATION_WINDOW_TURNS (30) so a TOLD row is never queried out of the
// prompt sooner than it could still be a fresh-enough rumor to mention.
const RECENT_WITNESS_WINDOW_TURNS = 60

/**
 * Shared between both builders below. Scoped to `characterIds` only — a
 * non-participant character's witness rows never leak into a split-party
 * scene's prompt, same fog-of-war discipline as everything else here.
 */
async function fetchWitnessMap(
  campaignId: string,
  characterIds: string[],
  currentTurnNumber: number
): Promise<Map<string, GroupedWitness>> {
  if (characterIds.length === 0) return new Map()
  const rows = await prisma.eventWitness.findMany({
    where: {
      campaignId,
      characterId: { in: characterIds },
      turnNumber: { gte: currentTurnNumber - RECENT_WITNESS_WINDOW_TURNS },
    },
    orderBy: { turnNumber: 'desc' },
    select: { characterId: true, grade: true, turnNumber: true, worldEvent: { select: { reason: true } } },
  })
  return groupEventWitnessesForPrompt(rows.map((r) => ({
    characterId: r.characterId, grade: r.grade, turnNumber: r.turnNumber, reason: r.worldEvent.reason,
  })))
}

/**
 * Scene-participant scoping (split-party support): a scene the GM created
 * for specific characters (Character-Focused, or one half of a split
 * party) should only put those characters' sheets in front of the AI —
 * otherwise a sibling concurrent scene's party leaks into this one's
 * context. `participantCharacterIds` is Scene.participants.characterIds;
 * null/empty (a genuinely open scene) returns the full roster unchanged.
 * Pure and exported so it's unit-testable without a DB.
 */
/** "winter" -> "Winter" — season is otherwise a plain lowercase union value. */
function capitalize(season: string): string {
  return season.charAt(0).toUpperCase() + season.slice(1)
}

export function scopeCharactersToParticipants<T extends { id: string }>(
  characters: T[],
  participantCharacterIds?: string[] | null
): T[] {
  return participantCharacterIds && participantCharacterIds.length > 0
    ? characters.filter(c => participantCharacterIds.includes(c.id))
    : characters
}

/**
 * Build optimized world summary using context manager
 * Reduces token usage for large campaigns (10+ scenes)
 *
 * @param campaignId - Campaign ID
 * @param currentSceneNumber - Current scene number
 * @returns Optimized world summary with location-based filtering and fetched entities
 */
export async function buildOptimizedWorldSummary(
  campaignId: string,
  currentSceneNumber: number,
  // Scene.participants.characterIds, when the active scene has an explicit
  // participant list (a GM-scoped "Character-Focused" scene, or a split-
  // party scene) — narrows the character roster (and the location-based
  // NPC/faction relevance derived from it below) to just this scene's
  // characters, so a sibling concurrent scene's party doesn't leak into
  // this one's context. null/undefined (an open scene) keeps the full
  // living roster, exactly as before this parameter existed.
  participantCharacterIds?: string[] | null
): Promise<{ worldSummary: AIGMRequest['world_summary'], entities: { characters: any[], npcs: any[], factions: any[] } }> {
  console.log('🎯 Building optimized world summary with location filtering')

  // Get optimized context from context manager
  const optimizedContext = await buildOptimizedContext(prisma, campaignId, currentSceneNumber)

  // Get current data
  const [worldMeta, characters, allNpcs, allFactions, locations, clocks, activeWars, activeQuests] = await Promise.all([
    prisma.worldMeta.findUnique({
      where: { campaignId },
      include: { campaign: { select: { calendarConfig: true } } },
    }),
    prisma.character.findMany({
      where: { campaignId, isAlive: true },
      include: {
        user: { select: { email: true } },
        // Knowledge-relative sheet: what each character knows exists /
        // can do — the prompt gates narration on this per character.
        capabilities: { include: { capability: true } },
        // Debt economy: open favors are leverage the AI should play with.
        // #221: bounded and ordered most-recent-first — a debt-heavy
        // campaign was an unbounded prompt-growth risk with no cap at all.
        debts: { where: { status: 'OUTSTANDING' }, orderBy: { createdAt: 'desc' }, take: 20 },
        // Faction standing: social position, shown qualitatively.
        factionStandings: {
          include: { faction: { select: { name: true, isActive: true, isDiscovered: true } } }
        }
      }
    }),
    prisma.nPC.findMany({ where: { campaignId } }),
    prisma.faction.findMany({ where: { campaignId } }),
    prisma.location.findMany({ where: { campaignId, isDiscovered: true } }),
    prisma.clock.findMany({
      where: { campaignId, isHidden: false }
    }),
    // World Sim Phase 5: sustained conflicts — narrate from real momentum
    // and duration, don't invent how a war is going. Coalitions: pull
    // participants so ally counts can be surfaced too (see wars mapping
    // below) — isDiscovered on the faction so an undiscovered ally's
    // existence isn't leaked just because it joined a known war.
    prisma.war.findMany({
      where: { campaignId, status: 'ESCALATING' },
      include: { participants: { include: { faction: { select: { id: true, isDiscovered: true } } } } }
    }),
    // Open quests, so the AI advances/closes them instead of forgetting
    // or duplicating them (quest_changes in world_updates).
    prisma.quest.findMany({
      where: { campaignId, status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' }
    })
  ])

  if (!worldMeta) {
    throw new Error('WorldMeta not found')
  }

  // Scene-participant scoping — see scopeCharactersToParticipants' doc
  // comment above. entities.characters (returned below) stays the full
  // unfiltered list for memory/lore continuity, matching the existing
  // fog-of-war precedent for NPCs/factions (relevance filtering only ever
  // touches worldSummary, never entities).
  const promptCharacters = scopeCharactersToParticipants(characters, participantCharacterIds)

  // Information Latency (#101) — each character's own knowledge of
  // significant WorldEvents, scoped to just this builder's promptCharacters.
  const witnessByCharacterId = await fetchWitnessMap(
    campaignId, promptCharacters.map(c => c.id), worldMeta.currentTurnNumber
  )

  // Extract character locations for filtering — scoped to this scene's
  // characters, so an NPC only "nearby" a sibling scene's location isn't
  // pulled into this one's context.
  const characterLocations = new Set(
    promptCharacters.map(c => c.currentLocation).filter(Boolean)
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
  const characterConsequences = promptCharacters.flatMap(c => {
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

  // Fog of war: relevance and discovery are separate gates — a "relevant"
  // NPC/faction (nearby, a high threat) still isn't narrated as known if
  // the party has never actually encountered them. Only affects what goes
  // into worldSummary below, not `entities` at the bottom of this
  // function, which stays unfiltered on purpose for memory-recall lookups.
  // capForPrompt: a hard backstop on top of the relevance filtering above —
  // keeps the most important entities by that same signal if the filtered
  // set is still too large for a maximally active campaign.
  const discoveredNpcNameById = new Map(relevantNpcs.filter(npc => npc.isDiscovered).map(n => [n.id, n.name]))
  const discoveredNpcs = capForPrompt(relevantNpcs.filter(npc => npc.isDiscovered), MAX_NPCS_IN_PROMPT, n => n.importance)
  const discoveredFactionIds = new Set(allFactions.filter(f => f.isDiscovered).map(f => f.id))
  const discoveredFactions = capForPrompt(relevantFactions.filter(f => f.isDiscovered), MAX_FACTIONS_IN_PROMPT, f => f.threatLevel)

  console.log(`🔍 Filtered entities: ${discoveredNpcs.length}/${allNpcs.length} NPCs, ${discoveredFactions.length}/${allFactions.length} factions`)

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

  const worldSummary = {
    turn_number: worldMeta.currentTurnNumber,
    // Pacing guidance, derived deterministically from live state each
    // world turn (see tick/tension.ts) — never a number the AI reports or
    // reads. Qualitative for the same reason faction stats are: an exact
    // "tension: 78" is trivial for the narrator to blurt out as something
    // no character could know.
    dramatic_tension: describeTension(worldMeta.tension),
    story_phase: worldMeta.phase || derivePhase(worldMeta.tension, worldMeta.currentTurnNumber),
    in_game_date: worldMeta.currentInGameDate || 'Day 1',
    // #118: narration flavor, alongside (not instead of) the mechanical
    // resource-regen/clock-speed knobs — see tick/seasonTick.ts.
    season: capitalize(deriveSeason(
      worldMeta.totalElapsedGameHours,
      worldMeta.campaign?.calendarConfig ? (worldMeta.campaign.calendarConfig as unknown as GeneratedCalendar) : null
    )),

    // Include campaign summary in a special field (we'll handle this in the prompt)
    _campaignSummary: campaignSummaryText,

    characters: mapCharactersForPrompt(promptCharacters, witnessByCharacterId),

    // Only relevant, discovered NPCs — fog of war: relevance alone isn't
    // enough, the party has to have actually encountered them.
    npcs: mapNpcsForPrompt(discoveredNpcs, discoveredNpcNameById),

    // Only relevant, discovered factions. Numeric stats are deliberately
    // qualitative here, not exact — the deterministic tick needs the real
    // numbers and reads them straight from Prisma; this prompt is narration
    // only, and an exact "resources: 73" is trivial for the AI to blurt out
    // as something no player could know in-fiction.
    factions: mapFactionsForPrompt(discoveredFactions),

    // capForPrompt: contested locations are the ones actually worth
    // narrating in a crowded world — kept preferentially if there's an
    // excess.
    locations: mapLocationsForPrompt(locations, discoveredFactionIds),

    // capForPrompt: clocks closest to firing are the most narratively
    // urgent — kept preferentially if there's an excess.
    clocks: mapClocksForPrompt(clocks),

    // #244 (adversarial audit): this builder used to be the one place
    // MAX_QUESTS_IN_PROMPT wasn't applied — buildWorldSummaryForAI below
    // capped quests, this one didn't, so which builder ran for a given
    // request (sceneResolutionRequest.ts picks by scene count) decided
    // whether a large active-quest list was actually bounded. Worse, this
    // is the builder used once a campaign has 10+ scenes — exactly where
    // an unbounded quest list is most likely to have grown large. Same
    // capForPrompt(..., createdAt) "keep the most recent" priority as the
    // sibling builder, so a capped result looks the same regardless of
    // which builder produced it.
    quests: mapQuestsForPrompt(capForPrompt(activeQuests, MAX_QUESTS_IN_PROMPT, q => q.createdAt.getTime())),

    // World Sim Phase 5: sustained conflicts — only ones where both sides
    // are discovered; the party can't hear about a war between two
    // factions they've never encountered. Coalitions: ally counts only
    // include discovered factions, same fog-of-war rule as everything else
    // here — a hidden faction joining a known war doesn't get outed by it.
    wars: mapWarsForPrompt(activeWars, allFactions, discoveredFactionIds, worldMeta.currentTurnNumber),

    // Use compressed timeline from context manager
    recent_timeline_events: compressedTimeline
  } as any

  // Return both world summary and entities for reuse in memory retrieval.
  // clampPromptStrings applies only to worldSummary — the prompt-bound half.
  // `entities` deliberately stays unclamped: it feeds memory-retrieval
  // entity matching, where a truncated name/description would silently
  // change which memories get recalled.
  return {
    worldSummary: clampPromptStrings(worldSummary),
    entities: {
      characters,
      npcs: allNpcs, // Return ALL npcs, not filtered ones, for memory retrieval
      factions: allFactions // Return ALL factions, not filtered ones, for memory retrieval
    }
  }
}

/**
 * Fetch and serialize all world state for a campaign
 * This creates a clean, AI-readable summary of the entire game world
 *
 * @param campaignId - The campaign to summarize
 * @returns Formatted world state ready for AI and fetched entities
 */
export async function buildWorldSummaryForAI(
  campaignId: string,
  // See buildOptimizedWorldSummary's doc comment above for what this
  // scopes and why.
  participantCharacterIds?: string[] | null
): Promise<{ worldSummary: AIGMRequest['world_summary'], entities: { characters: any[], npcs: any[], factions: any[] } }> {
  console.log('📊 Building world summary for campaign:', campaignId)

  // Fetch all relevant data in parallel for speed
  const [
    campaign,
    worldMeta,
    characters,
    npcs,
    factions,
    locations,
    clocks,
    recentEvents,
    activeWars,
    activeQuests
  ] = await Promise.all([
    prisma.campaign.findUnique({ where: { id: campaignId } }),
    prisma.worldMeta.findUnique({ where: { campaignId } }),
    prisma.character.findMany({
      where: { campaignId, isAlive: true },
      include: {
        user: { select: { email: true } },
        // Knowledge-relative sheet — see the optimized builder above.
        capabilities: { include: { capability: true } },
        // Debt economy — see the optimized builder above. #221: same bound.
        debts: { where: { status: 'OUTSTANDING' }, orderBy: { createdAt: 'desc' }, take: 20 },
        // Faction standing — see the optimized builder above.
        factionStandings: {
          include: { faction: { select: { name: true, isActive: true, isDiscovered: true } } }
        }
      }
    }),
    prisma.nPC.findMany({ where: { campaignId } }),
    prisma.faction.findMany({ where: { campaignId } }),
    prisma.location.findMany({ where: { campaignId, isDiscovered: true } }),
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
    }),
    // World Sim Phase 5: sustained conflicts — narrate from real momentum
    // and duration, don't invent how a war is going. Coalitions: pull
    // participants for ally counts (see wars mapping below).
    prisma.war.findMany({
      where: { campaignId, status: 'ESCALATING' },
      include: { participants: { include: { faction: { select: { id: true, isDiscovered: true } } } } }
    }),
    // Open quests, so the AI advances/closes them instead of forgetting
    // or duplicating them (quest_changes in world_updates).
    prisma.quest.findMany({
      where: { campaignId, status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' }
    })
  ])

  if (!campaign || !worldMeta) {
    throw new Error('Campaign or WorldMeta not found')
  }

  // Fog of war: this is the only gate between "the simulation knows about
  // it" and "the AI is allowed to narrate it." `entities` below stays
  // unfiltered on purpose (memory-recall lookups need the full set); only
  // worldSummary — what actually reaches the prompt — is filtered.
  // capForPrompt: a hard backstop on top of fog-of-war filtering (see
  // MAX_*_IN_PROMPT above) — this builder has no location/threat
  // relevance filtering at all (unlike buildOptimizedWorldSummary above),
  // so it's the more exposed of the two to unbounded growth in a
  // long-running, highly discovered campaign.
  const allDiscoveredNpcs = npcs.filter(n => n.isDiscovered)
  const discoveredNpcNameById = new Map(allDiscoveredNpcs.map(n => [n.id, n.name]))
  const discoveredNpcs = capForPrompt(allDiscoveredNpcs, MAX_NPCS_IN_PROMPT, n => n.importance)
  const allDiscoveredFactions = factions.filter(f => f.isDiscovered)
  const discoveredFactionIds = new Set(allDiscoveredFactions.map(f => f.id))
  const discoveredFactions = capForPrompt(allDiscoveredFactions, MAX_FACTIONS_IN_PROMPT, f => f.threatLevel)

  // Scene-participant scoping — see scopeCharactersToParticipants' doc
  // comment. entities (returned below) stays the full unfiltered
  // characters list.
  const promptCharacters = scopeCharactersToParticipants(characters, participantCharacterIds)

  // Information Latency (#101) — see the sibling builder above for the
  // full reasoning; same helper, same scoping.
  const witnessByCharacterId = await fetchWitnessMap(
    campaignId, promptCharacters.map(c => c.id), worldMeta.currentTurnNumber
  )

  // Format everything for the AI
  const worldSummary = {
    turn_number: worldMeta.currentTurnNumber,
    // Pacing guidance, derived deterministically from live state each
    // world turn (see tick/tension.ts) — never a number the AI reports or
    // reads. Qualitative for the same reason faction stats are: an exact
    // "tension: 78" is trivial for the narrator to blurt out as something
    // no character could know.
    dramatic_tension: describeTension(worldMeta.tension),
    story_phase: worldMeta.phase || derivePhase(worldMeta.tension, worldMeta.currentTurnNumber),
    in_game_date: worldMeta.currentInGameDate || 'Day 1',
    // #118: narration flavor, alongside (not instead of) the mechanical
    // resource-regen/clock-speed knobs — see tick/seasonTick.ts.
    season: capitalize(deriveSeason(
      worldMeta.totalElapsedGameHours,
      campaign.calendarConfig ? (campaign.calendarConfig as unknown as GeneratedCalendar) : null
    )),

    characters: mapCharactersForPrompt(promptCharacters, witnessByCharacterId),

    npcs: mapNpcsForPrompt(discoveredNpcs, discoveredNpcNameById),

    // Numeric stats are deliberately qualitative here, not exact — see
    // qualitativeStats.ts. The deterministic tick reads real numbers
    // straight from Prisma and never goes through this prompt.
    factions: mapFactionsForPrompt(discoveredFactions),

    clocks: mapClocksForPrompt(clocks),

    quests: mapQuestsForPrompt(capForPrompt(activeQuests, MAX_QUESTS_IN_PROMPT, q => q.createdAt.getTime())),

    locations: mapLocationsForPrompt(locations, discoveredFactionIds),

    recent_timeline_events: recentEvents.map(e => ({
      title: e.title,
      summary: e.summaryPublic || e.summaryGM || 'No summary available',
      turn_number: e.turnNumber
    })),

    // World Sim Phase 5: sustained conflicts currently in progress. Narrate
    // "how's the war going" from momentum/turns_elapsed, don't improvise.
    // Fog of war: only wars where both sides are discovered; ally counts
    // only include discovered factions.
    wars: mapWarsForPrompt(activeWars, factions, discoveredFactionIds, worldMeta.currentTurnNumber),
  } as any

  // Return both world summary and entities for reuse in memory retrieval.
  // See the sibling builder above for why only worldSummary is clamped.
  return {
    worldSummary: clampPromptStrings(worldSummary),
    entities: {
      characters,
      npcs,
      factions
    }
  }
}

// NOTE: there is deliberately no buildFullWorldState(campaignId).
//
// It was documented as "used for admin views and debugging" and had no
// callers. A caller was looked for; wiring one in would have been a
// security regression rather than a fix. It took a campaignId and nothing
// else — no membership check, no role check — and returned every hidden
// clock and GM-only timeline event unconditionally.
//
// The real admin view is GET /api/campaigns/[id], which loads the same set
// and gates each relation on membership.role: an undiscovered NPC or a
// hidden clock never reaches a non-admin's response at all. That is the
// fog-of-war-at-the-query-layer rule this codebase enforces everywhere,
// and this function was a way around it waiting for someone to call it.
