import { openaiFetch } from '@/lib/ai/openaiCompat'
import { reportError } from '@/lib/monitoring'
// src/lib/ai/worldState.ts
// Convert database records into a clean format for the AI GM

import { prisma } from '@/lib/prisma'
import { AIGMRequest } from './client'
import { ComplexExchangeResolver, NarrativeFlowManager } from '@/lib/game/complex-exchange-resolver' // Phase 16
import { buildOptimizedContext, capForPrompt } from './contextManager' // Phase 14.6: Context optimization
import { retrieveRelevantHistory, retrieveNpcHistory, retrieveCrossEntityHistory, generateEntityPairs, buildSearchQuery } from './memoryRetrieval' // Campaign Memory RAG
import { retrieveRelevantLore } from './loreRetrieval' // Imported lore RAG (see lib/lore/)
import { AI_MODELS } from './models'
import { recordAICost, estimateTokenCount } from './cost-tracker'
import { describeStat, describeThreatLevel, describeWarMomentum } from './qualitativeStats'
import { summarizeCapabilities } from '@/lib/game/capabilities'
import { resolveActionMechanics } from '@/lib/game/resolution'
import { summarizeDebts } from '@/lib/game/debts'
import { summarizeStandings } from '@/lib/game/standing'
import { parseCorruptionTheme, describeCorruptionForPrompt } from '@/lib/game/corruption'
import { parseFactionRelationships } from '@/lib/game/tick/types'

// Depth-hardening #37 (see README): hard per-category caps on the live
// world-state payload, applied via capForPrompt below — a backstop against
// unbounded prompt/token growth in a maximally active long campaign. Under
// each cap, nothing changes; only an excess triggers priority-ordered
// trimming. Numbers are generous relative to what a typical scene actually
// needs narrated in detail.
const MAX_NPCS_IN_PROMPT = 15
const MAX_FACTIONS_IN_PROMPT = 10
const MAX_LOCATIONS_IN_PROMPT = 12
const MAX_CLOCKS_IN_PROMPT = 10
const MAX_QUESTS_IN_PROMPT = 8

/**
 * Phase 9 NPC society: resolve NPC.socialTies into AI-facing lines, naming
 * only OTHER discovered NPCs — fog of war applies to social ties exactly
 * like every other NPC-facing field the prompt builders below already gate.
 */
function describeNpcSocialTies(rawTies: unknown, discoveredNpcNameById: Map<string, string>): string[] {
  const ties = parseFactionRelationships(rawTies)
  const lines: string[] = []
  for (const [otherId, tie] of Object.entries(ties)) {
    const name = discoveredNpcNameById.get(otherId)
    if (!name) continue
    lines.push(`${tie.type === 'ALLY' ? 'ally' : 'rival'}: ${name}`)
  }
  return lines
}

/**
 * Last appended beat of a quest's progress log — the prompt only needs
 * "where this quest currently stands", not its whole history.
 */
function lastProgressBeat(progressLog: string | null): string | null {
  if (!progressLog) return null
  const lines = progressLog.split('\n').map(l => l.trim()).filter(Boolean)
  return lines.length > 0 ? lines[lines.length - 1] : null
}

/**
 * Build optimized world summary using context manager
 * Reduces token usage for large campaigns (10+ scenes)
 *
 * @param campaignId - Campaign ID
 * @param currentSceneNumber - Current scene number
 * @returns Optimized world summary with location-based filtering and fetched entities
 */
async function buildOptimizedWorldSummary(
  campaignId: string,
  currentSceneNumber: number
): Promise<{ worldSummary: AIGMRequest['world_summary'], entities: { characters: any[], npcs: any[], factions: any[] } }> {
  console.log('🎯 Building optimized world summary with location filtering')

  // Get optimized context from context manager
  const optimizedContext = await buildOptimizedContext(prisma, campaignId, currentSceneNumber)

  // Get current data
  const [worldMeta, characters, allNpcs, allFactions, locations, clocks, activeWars, activeQuests] = await Promise.all([
    prisma.worldMeta.findUnique({ where: { campaignId } }),
    prisma.character.findMany({
      where: { campaignId, isAlive: true },
      include: {
        user: { select: { email: true } },
        // Knowledge-relative sheet: what each character knows exists /
        // can do — the prompt gates narration on this per character.
        capabilities: { include: { capability: true } },
        // Debt economy: open favors are leverage the AI should play with.
        debts: { where: { status: 'OUTSTANDING' } },
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
      statUsage: c.statUsage,
      perks: c.perks,
      inventory: c.inventory,
      equipment: c.equipment,
      resources: c.resources,
      relationships: c.relationships,
      consequences: c.consequences,
      // Knowledge-relative sheet: qualitative bands + known-domains only —
      // raw proficiency numbers never reach a prompt (fog of war inward).
      origin_familiarity: c.originFamiliarity,
      capabilities: summarizeCapabilities(c.capabilities),
      // Open favors, both directions — the AI's leverage currency.
      debts: summarizeDebts(c.debts),
      // Social position with discovered active factions, qualitatively.
      standings: summarizeStandings(c.factionStandings)
    })),

    // Only relevant, discovered NPCs — fog of war: relevance alone isn't
    // enough, the party has to have actually encountered them.
    npcs: discoveredNpcs.map(n => ({
      id: n.id,
      name: n.name,
      description: n.description,
      goals: n.goals,
      relationship: n.relationship,
      importance: n.importance,
      // Cross-reference against the factions array below by id for the
      // faction's name/goal — kept as a bare id here rather than joined, to
      // avoid duplicating faction data into every affiliated NPC.
      factionId: n.factionId,
      factionRole: n.factionRole,
      // Phase 9 NPC society: this NPC's own web of allies/rivals.
      social_ties: describeNpcSocialTies(n.socialTies, discoveredNpcNameById)
    })),

    // Only relevant, discovered factions. Numeric stats are deliberately
    // qualitative here, not exact — the deterministic tick needs the real
    // numbers and reads them straight from Prisma; this prompt is narration
    // only, and an exact "resources: 73" is trivial for the AI to blurt out
    // as something no player could know in-fiction.
    factions: discoveredFactions.map(f => ({
      id: f.id,
      name: f.name,
      goals: f.goals,
      currentPlan: f.currentPlan,
      threat_level: describeThreatLevel(f.threatLevel),
      resources: describeStat(f.resources),
      influence: describeStat(f.influence),
      // World Sim Phase 6: set only when a player character leads this
      // faction — see the PLAYER-LED FACTIONS prompt instruction.
      leader_character_id: f.leaderCharacterId
    })),

    // capForPrompt: contested locations are the ones actually worth
    // narrating in a crowded world — kept preferentially if there's an
    // excess.
    locations: capForPrompt(locations, MAX_LOCATIONS_IN_PROMPT, l => (l.isContested ? 1 : 0)).map(l => ({
      name: l.name,
      description: l.description || '',
      type: l.locationType || 'unknown',
      // World Sim Phase 1: persistent weather, ticked independently of the
      // player. Reference this in narration instead of inventing weather.
      weather: l.weather,
      weather_severity: l.weatherSeverity,
      // World Sim Phase 4: cross-reference owner_faction_id against the
      // factions array for the controlling faction's name — narrate control
      // and contested status from this, don't invent your own map.
      // Fog of war: null if the owner isn't discovered — territory doesn't
      // reveal a faction's existence just because it's mapped.
      owner_faction_id: l.ownerFactionId && discoveredFactionIds.has(l.ownerFactionId) ? l.ownerFactionId : null,
      is_contested: l.isContested
    })),

    // capForPrompt: clocks closest to firing are the most narratively
    // urgent — kept preferentially if there's an excess.
    clocks: capForPrompt(clocks, MAX_CLOCKS_IN_PROMPT, cl => cl.maxTicks > 0 ? cl.currentTicks / cl.maxTicks : 0).map(cl => ({
      id: cl.id,
      name: cl.name,
      current_ticks: cl.currentTicks,
      max_ticks: cl.maxTicks,
      description: cl.description || '',
      consequence: cl.consequence || ''
    })),

    quests: activeQuests.map(q => ({
      name: q.name,
      description: q.description,
      objective: q.objective,
      given_by: q.givenBy,
      recent_progress: lastProgressBeat(q.progressLog)
    })),

    // World Sim Phase 5: sustained conflicts — only ones where both sides
    // are discovered; the party can't hear about a war between two
    // factions they've never encountered. Coalitions: ally counts only
    // include discovered factions, same fog-of-war rule as everything else
    // here — a hidden faction joining a known war doesn't get outed by it.
    wars: activeWars
      .filter(w => discoveredFactionIds.has(w.attackerFactionId) && discoveredFactionIds.has(w.defenderFactionId))
      .map(w => {
        const discoveredParticipants = w.participants.filter(p => p.faction.isDiscovered)
        const attackerAllies = discoveredParticipants.filter(p => p.side === 'ATTACKER' && p.factionId !== w.attackerFactionId).length
        const defenderAllies = discoveredParticipants.filter(p => p.side === 'DEFENDER' && p.factionId !== w.defenderFactionId).length
        return {
          name: w.name,
          attacker: allFactions.find(f => f.id === w.attackerFactionId)?.name || 'Unknown',
          defender: allFactions.find(f => f.id === w.defenderFactionId)?.name || 'Unknown',
          attacker_allies: attackerAllies,
          defender_allies: defenderAllies,
          momentum: describeWarMomentum(w.momentum),
          turns_elapsed: worldMeta.currentTurnNumber - w.startedTurn
        }
      }),

    // Use compressed timeline from context manager
    recent_timeline_events: compressedTimeline
  } as any

  // Return both world summary and entities for reuse in memory retrieval
  return {
    worldSummary,
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
export async function buildWorldSummaryForAI(campaignId: string): Promise<{ worldSummary: AIGMRequest['world_summary'], entities: { characters: any[], npcs: any[], factions: any[] } }> {
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
        // Debt economy — see the optimized builder above.
        debts: { where: { status: 'OUTSTANDING' } },
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

  // Format everything for the AI
  const worldSummary = {
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
      statUsage: c.statUsage,
      perks: c.perks,
      inventory: c.inventory,
      equipment: c.equipment,
      resources: c.resources,
      relationships: c.relationships,
      consequences: c.consequences,
      // Knowledge-relative sheet: qualitative bands + known-domains only —
      // raw proficiency numbers never reach a prompt (fog of war inward).
      origin_familiarity: c.originFamiliarity,
      capabilities: summarizeCapabilities(c.capabilities),
      // Open favors, both directions — the AI's leverage currency.
      debts: summarizeDebts(c.debts),
      // Social position with discovered active factions, qualitatively.
      standings: summarizeStandings(c.factionStandings)
    })),

    npcs: discoveredNpcs.map(n => ({
      id: n.id,
      name: n.name,
      description: n.description,
      goals: n.goals,
      relationship: n.relationship,
      importance: n.importance,
      factionId: n.factionId,
      factionRole: n.factionRole,
      // Phase 9 NPC society: this NPC's own web of allies/rivals.
      social_ties: describeNpcSocialTies(n.socialTies, discoveredNpcNameById)
    })),

    // Numeric stats are deliberately qualitative here, not exact — see
    // qualitativeStats.ts. The deterministic tick reads real numbers
    // straight from Prisma and never goes through this prompt.
    factions: discoveredFactions.map(f => ({
      id: f.id,
      name: f.name,
      goals: f.goals,
      currentPlan: f.currentPlan,
      threat_level: describeThreatLevel(f.threatLevel),
      resources: describeStat(f.resources),
      influence: describeStat(f.influence),
      leader_character_id: f.leaderCharacterId
    })),

    clocks: capForPrompt(clocks, MAX_CLOCKS_IN_PROMPT, cl => cl.maxTicks > 0 ? cl.currentTicks / cl.maxTicks : 0).map(cl => ({
      id: cl.id,
      name: cl.name,
      current_ticks: cl.currentTicks,
      max_ticks: cl.maxTicks,
      description: cl.description || '',
      consequence: cl.consequence || ''
    })),

    quests: capForPrompt(activeQuests, MAX_QUESTS_IN_PROMPT, q => q.createdAt.getTime()).map(q => ({
      name: q.name,
      description: q.description,
      objective: q.objective,
      given_by: q.givenBy,
      recent_progress: lastProgressBeat(q.progressLog)
    })),

    locations: capForPrompt(locations, MAX_LOCATIONS_IN_PROMPT, l => (l.isContested ? 1 : 0)).map(l => ({
      name: l.name,
      description: l.description || '',
      type: l.locationType || 'unknown',
      // World Sim Phase 1: persistent weather, ticked independently of the
      // player. Reference this in narration instead of inventing weather.
      weather: l.weather,
      weather_severity: l.weatherSeverity,
      // Fog of war: null if the owner isn't discovered — territory doesn't
      // reveal a faction's existence just because it's mapped.
      owner_faction_id: l.ownerFactionId && discoveredFactionIds.has(l.ownerFactionId) ? l.ownerFactionId : null,
      is_contested: l.isContested
    })),

    recent_timeline_events: recentEvents.map(e => ({
      title: e.title,
      summary: e.summaryPublic || e.summaryGM || 'No summary available',
      turn_number: e.turnNumber
    })),

    // World Sim Phase 5: sustained conflicts currently in progress. Narrate
    // "how's the war going" from momentum/turns_elapsed, don't improvise.
    // Fog of war: only wars where both sides are discovered; ally counts
    // only include discovered factions.
    wars: activeWars
      .filter(w => discoveredFactionIds.has(w.attackerFactionId) && discoveredFactionIds.has(w.defenderFactionId))
      .map(w => {
        const discoveredParticipants = w.participants.filter(p => p.faction.isDiscovered)
        const attackerAllies = discoveredParticipants.filter(p => p.side === 'ATTACKER' && p.factionId !== w.attackerFactionId).length
        const defenderAllies = discoveredParticipants.filter(p => p.side === 'DEFENDER' && p.factionId !== w.defenderFactionId).length
        return {
          name: w.name,
          attacker: factions.find(f => f.id === w.attackerFactionId)?.name || 'Unknown',
          defender: factions.find(f => f.id === w.defenderFactionId)?.name || 'Unknown',
          attacker_allies: attackerAllies,
          defender_allies: defenderAllies,
          momentum: describeWarMomentum(w.momentum),
          turns_elapsed: (worldMeta?.currentTurnNumber ?? w.startedTurn) - w.startedTurn
        }
      })
  } as any

  // Return both world summary and entities for reuse in memory retrieval
  return {
    worldSummary,
    entities: {
      characters,
      npcs,
      factions
    }
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

  // Phase 14.6: Use optimized context for campaigns with 10+ scenes
  const sceneCount = await prisma.scene.count({ where: { campaignId } })
  let worldSummary: AIGMRequest['world_summary']
  let entities: { characters: any[], npcs: any[], factions: any[] }

  if (sceneCount >= 10) {
    console.log('📉 Using optimized context (campaign has', sceneCount, 'scenes)')
    const result = await buildOptimizedWorldSummary(campaignId, scene.sceneNumber)
    worldSummary = result.worldSummary
    entities = result.entities
  } else {
    console.log('📊 Using full context (campaign has', sceneCount, 'scenes)')
    const result = await buildWorldSummaryForAI(campaignId)
    worldSummary = result.worldSummary
    entities = result.entities
  }

  // The mechanical spine: classify + server-roll every pending action in
  // this exchange BEFORE the narrator sees them, so outcome bands arrive
  // as binding constraints. Fails open to [] — freeform resolution.
  const pendingActions = scene.playerActions.filter(a => a.status === 'pending')
  const actionMechanics = await resolveActionMechanics(
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
    // OPTIMIZATION: Only include the last 2 exchanges to prevent prompt bloat
    // Split by the separator used when appending resolutions
    const allResolutions = scene.sceneResolutionText.split('\n\n---\n\n')
    const recentResolutions = allResolutions.slice(-2) // Last 2 exchanges only

    if (recentResolutions.length > 0) {
      sceneContext += '\n\n## What Has Happened Recently:\n\n' + recentResolutions.join('\n\n---\n\n')
    }
  }

  // RAG Memory Retrieval: Get relevant campaign history
  // OPTIMIZATION: Reuse entities already fetched in world summary to avoid duplicate queries
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
      }
    )

    console.log(`✅ Retrieved ${relevantMemories.length} relevant memories`)
  } catch (memoryError) {
    const errorMsg = memoryError instanceof Error ? memoryError.message : String(memoryError)
    console.error('⚠️ Memory retrieval failed:', errorMsg)
    // Log but continue - scene resolution can work without memories if needed
  }

  // Imported Lore Retrieval: search any pasted/URL/wiki lore the GM has
  // imported (see lib/lore/) for what's relevant to this scene. Same
  // scene-context query text memory retrieval uses, so a query naming an
  // NPC or location matches lore about it the same way it matches history.
  let relevantLore: any[] = []
  try {
    const query = buildSearchQuery({
      currentScene: scene,
      playerActions: scene.playerActions,
      characters: entities.characters,
      npcs: entities.npcs,
      factions: entities.factions,
    })
    relevantLore = await retrieveRelevantLore(campaignId, query, { maxEntries: 5, minSimilarity: 0.75 })
    if (relevantLore.length > 0) {
      console.log(`📚 Retrieved ${relevantLore.length} relevant lore entries`)
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

  return {
    campaign_universe: campaign.universe || 'Generic Fantasy',
    ai_system_prompt: enhancedSystemPrompt + (fullGuidance ? `\n\n${fullGuidance}` : ''),
    world_summary: worldSummaryWithMemories,
    current_scene_intro: sceneContext,
    corruption_theme: corruptionThemeForPrompt,
    safety_lines: safetySettings?.lines ?? [],
    safety_veils: safetySettings?.veils ?? [],
    player_actions: playerActions,
    action_mechanics: actionMechanics
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

  // Lines and veils (see lib/safety/safety-service.ts) — this prompt is
  // built independently of buildSceneResolutionRequest's client.ts <safety>
  // section, so it needs its own instruction text below.
  const safetySettings = await prisma.campaignSafetySettings.findUnique({
    where: { campaignId },
    select: { lines: true, veils: true },
  })
  const lines = safetySettings?.lines ?? []
  const veils = safetySettings?.veils ?? []
  const safetyText = lines.length > 0 || veils.length > 0
    ? `\n\nCONTENT BOUNDARIES (override everything else, including genre conventions):${
        lines.length > 0 ? `\nHARD LINES — never include or approach, even obliquely: ${lines.join('; ')}` : ''
      }${
        veils.length > 0 ? `\nSOFT VEILS — may happen off-page, never described directly: ${veils.join('; ')}` : ''
      }`
    : ''

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

  const { worldSummary: worldSummaryData } = await buildWorldSummaryForAI(campaignId)

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

  // Offscreen fallout since the last scene resolved — the world keeps
  // ticking between scenes (world turns, faction ambitions, NPC moves) but
  // nothing forces it into view unless the opener reaches for it.
  // buildWorldSummaryForAI's recent_timeline_events mixes onscreen and
  // offscreen together with no distinction; this is a dedicated,
  // offscreen-only fetch so the opener can be told specifically "this
  // happened while nobody was looking."
  const offscreenFallout = lastScene
    ? await prisma.timelineEvent.findMany({
        where: {
          campaignId,
          isOffscreen: true,
          visibility: { in: ['PUBLIC', 'MIXED'] },
          createdAt: { gt: lastScene.updatedAt },
        },
        orderBy: { turnNumber: 'desc' },
        take: 3,
        select: { title: true, summaryPublic: true },
      })
    : []

  const offscreenFalloutText = offscreenFallout.length > 0
    ? `\n\nOFFSCREEN DEVELOPMENTS (happened in the world since the last scene, unseen by the party - the characters don't know these outright, but the atmosphere can carry a hint: a rumor overheard, a changed mood in the street, smoke where there wasn't any before):\n${offscreenFallout.map(e => `- ${e.title}: ${e.summaryPublic || 'details unclear'}`).join('\n')}`
    : ''

  const apiKey = process.env.OPENAI_API_KEY
  const startTime = Date.now()
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

  // The campaign opener has no prior scene to be "mid-action" relative to —
  // dropping straight into a fight or chase here reads as arbitrary, not
  // tense, because nothing has grounded where the character even is yet.
  // Scene 2+ always follows a resolution that already established the
  // situation, so in-medias-res works there. Only the opener needs a
  // (brief) establishing beat before the hook.
  const isFirstScene = !lastScene

  const openingGuidance = isFirstScene
    ? `**TONE & STYLE:**
- Open with a brief establishing beat: where the character is, what they're doing, what the place feels like — one or two sentences of real ground beneath their feet before anything else happens
- Show, don't tell - use vivid sensory details
- Once they're grounded, introduce something that demands a choice - tension, an arrival, a discovery
- Be subtle - weave in character details naturally, don't list them
- Match the tone of ${campaign.universe}

**WHAT TO INCLUDE:**
- A real place and moment the character can picture themselves standing in, before the hook lands
- Clear stakes - something starts to matter as the beat unfolds
- Hints at the character's background/goals through context, not exposition
- A dramatic question or choice that demands action by the end
- 2-3 paragraphs maximum

**WHAT TO AVOID:**
- Generic openings ("The heroes gather...", "Times are uncertain...")
- Starting mid-fight, mid-chase, or mid-crisis with zero setup — this is the character's first moment in the story, not their fiftieth
- Character introductions or descriptions
- Listing equipment, stats, or inventory
- Explaining backstories or goals directly
- Long exposition dumps
- "Your character feels/thinks/remembers" - stay external and immersive

**APPROACH:**
Start with the character somewhere concrete and grounded - their location if one is known, otherwise a place that fits their concept and the universe. Let the reader settle into that place for a beat. Then let the hook arrive: a stranger approaches, something goes wrong, a choice presents itself. If they have enemies or goals, let those color what "wrong" or "urgent" looks like. Setup, then stakes - not stakes with no setup.

Example: Instead of opening on a mid-swing sword fight, write "The tavern's back room smells of tallow and spilled ale. Three days he's waited at this table, and now the door creaks open" - then let the hook follow.`
    : `**TONE & STYLE:**
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
If they have a location, start there mid-scene. If they have enemies, maybe hint at danger. If they have goals, drop them into a situation that challenges those goals. But do it all through ATMOSPHERE and ACTION, not explanation.${offscreenFallout.length > 0 ? ' If any OFFSCREEN DEVELOPMENTS are listed below, let one of them color this scene\'s atmosphere - a detail, a mood, something glimpsed or overheard - so the world visibly moved while the party was elsewhere. Don\'t announce it as news; the characters don\'t know it as fact yet.' : ''}

Example: Instead of "You check your sword as you remember your oath of vengeance," write "The blade catches firelight from the distant campfires. Three days of tracking, and finally, smoke on the horizon."`

  const prompt = `You are the Game Master for a ${campaign.universe} campaign.

${campaign.aiSystemPrompt}

WORLD STATE:
${JSON.stringify(worldSummaryData, null, 2)}
${characterContext}

LAST SCENE RESOLUTION:
${lastScene?.sceneResolutionText || 'This is the first scene of the campaign. There is no prior action to continue from - the character has not yet set foot in the story.'}
${offscreenFalloutText}${safetyText}

Generate an engaging, atmospheric scene introduction that:

${openingGuidance}

Write ONLY the scene introduction. No JSON, no meta-commentary, no character sheets.`

  try {
    const response = await openaiFetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: AI_MODELS.FLAGSHIP, // Flagship model for scene intros - first impression shapes the whole session
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

    const usage = data.usage || {}
    await recordAICost({
      campaignId,
      model: AI_MODELS.FLAGSHIP,
      requestType: 'scene_intro',
      inputTokens: usage.prompt_tokens || estimateTokenCount(prompt),
      outputTokens: usage.completion_tokens || estimateTokenCount(sceneIntro),
      responseTimeMs: Date.now() - startTime,
      success: true
    }).catch(console.error)

    console.log('✅ Scene intro generated:', sceneIntro.substring(0, 100) + '...')

    return sceneIntro
  } catch (error) {
    console.error('❌ Scene intro generation failed:', error)
    // The fallback below is what players see as the "generic opening" —
    // make sure the REASON reaches the error webhook, not just the logs.
    await reportError('scene-intro-generation-failed', error, { campaignId })

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
