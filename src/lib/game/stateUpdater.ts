// src/lib/game/stateUpdater.ts
// Apply AI GM world updates to the database.
// This is where the AI's narrative decisions become persistent game state.
//
// This file is the orchestrator only: it fetches the shared per-batch
// entity rosters once (see entityResolution.ts) and calls one domain
// applier per world_updates field, in the same order the original
// monolithic implementation did. Each domain applier lives in
// ./worldUpdaters/ and is independently unit-tested — see README Known
// Bugs P1 (stateUpdater decomposition, #4/#41) for why this file used to
// be ~1,400 lines with no direct test coverage.

import { openaiFetch } from '@/lib/ai/openaiCompat'
import { prisma } from '@/lib/prisma'
import { AIGMResponse } from '@/lib/ai/client'
import { AI_MODELS } from '@/lib/ai/models'
import { recordAICost, estimateTokenCount } from '@/lib/ai/cost-tracker'
import { parseCorruptionTheme, CorruptionTheme } from './corruption'

import { applyTimelineEventChanges } from './worldUpdaters/timelineEvents'
import { applyClockChanges } from './worldUpdaters/clocks'
import { applyNpcChanges } from './worldUpdaters/npcs'
import { applyCharacterChanges } from './worldUpdaters/characters'
import { applyFactionChanges } from './worldUpdaters/factions'
import { applyLocationChanges } from './worldUpdaters/locations'
import { applyQuestChanges } from './worldUpdaters/quests'
import { applyBargainOffers } from './worldUpdaters/bargainOffers'
import { storeGmNotesForTurn } from './worldUpdaters/worldMetaNotes'

/**
 * Apply all world updates from an AI GM response to the database
 * This is transactional - if any update fails, all are rolled back
 *
 * @param campaignId - Campaign to update
 * @param aiResponse - AI GM's response with world_updates
 * @param currentTurnNumber - The turn number being resolved
 */
export interface AppliedWorldUpdates {
  /** NPC IDs actually resolved/created while applying npc_changes — the scene's real entity linkage. */
  involvedNpcIds: string[]
  /** Faction IDs actually resolved/created while applying faction_changes. */
  involvedFactionIds: string[]
}

export async function applyWorldUpdates(
  campaignId: string,
  aiResponse: AIGMResponse,
  currentTurnNumber: number,
  // Fog of war: true when this call is resolving a scene the players are
  // actually in — the party witnessing an NPC/faction is what reveals them,
  // so isDiscovered only flips to true on this path. Offscreen background
  // events (see worldTurn.ts) pass false: the simulation moving a faction
  // the party has never met must not silently teach the AI to talk about
  // it as if they had.
  sceneOrigin: boolean = true
): Promise<AppliedWorldUpdates> {
  console.log('💾 Applying world updates to database...')

  const { world_updates } = aiResponse

  let involvedNpcIds: string[] = []
  let involvedFactionIds: string[] = []

  try {
    await prisma.$transaction(async (tx) => {
      // Lazily fetched the first time a corruption_change or bargain_offer
      // appears, and shared between the two — undefined means "not looked
      // up yet", null means "this campaign has no theme".
      let corruptionTheme: CorruptionTheme | null | undefined = undefined
      const getCorruptionTheme = async (): Promise<CorruptionTheme | null> => {
        if (corruptionTheme === undefined) {
          const campaignRow = await tx.campaign.findUnique({
            where: { id: campaignId },
            select: { corruptionTheme: true }
          })
          corruptionTheme = parseCorruptionTheme(campaignRow?.corruptionTheme)
        }
        return corruptionTheme
      }

      // 1. Create timeline events
      if (world_updates.new_timeline_events) {
        await applyTimelineEventChanges(tx, campaignId, currentTurnNumber, world_updates.new_timeline_events)
      }

      // Fetched once per batch and resolved against in-memory (exact -> a
      // single confident fuzzy match) rather than a per-item `contains`
      // query — see entityResolution.ts. `contains` could both cross-match
      // an unrelated entity whose name merely contained the search string,
      // and fail on a trivial AI-side typo, silently auto-creating a
      // duplicate stub instead of updating the real one. Known Bugs P0.
      const clocksForResolution = world_updates.clock_changes?.length
        ? await tx.clock.findMany({ where: { campaignId } })
        : []
      const npcsForResolution = world_updates.npc_changes?.length
        ? await tx.nPC.findMany({ where: { campaignId } })
        : []
      const charactersForResolution = (world_updates.npc_changes?.length || world_updates.pc_changes?.length)
        ? await tx.character.findMany({ where: { campaignId } })
        : []
      const factionsForResolution = world_updates.faction_changes?.length
        ? await tx.faction.findMany({ where: { campaignId } })
        : []

      // 2. Update clocks
      if (world_updates.clock_changes) {
        await applyClockChanges(tx, world_updates.clock_changes, clocksForResolution)
      }

      // 3. Update NPCs
      if (world_updates.npc_changes) {
        const result = await applyNpcChanges(
          tx, campaignId, world_updates.npc_changes, npcsForResolution, charactersForResolution, sceneOrigin
        )
        involvedNpcIds = result.involvedNpcIds
      }

      // 4. Update player characters
      if (world_updates.pc_changes) {
        await applyCharacterChanges(
          tx, campaignId, currentTurnNumber, world_updates.pc_changes, charactersForResolution, getCorruptionTheme, sceneOrigin
        )
      }

      // organic_advancement (stat_increases/new_perks/new_moves) is deliberately
      // NOT processed here — applyOrganicCharacterGrowth in sceneResolver.ts is
      // the single writer for it (merges this with system-computed growth,
      // validates PbtA stat constraints, dedupes perks/moves by id). Processing
      // it here too would double-apply every stat increase, perk, and move the
      // AI reports, since both run in the same resolution.

      // 6. Update factions
      if (world_updates.faction_changes) {
        const result = await applyFactionChanges(
          tx, campaignId, world_updates.faction_changes, factionsForResolution, sceneOrigin
        )
        involvedFactionIds = result.involvedFactionIds
      }

      // 7. Upsert locations
      if (world_updates.location_changes) {
        await applyLocationChanges(tx, campaignId, world_updates.location_changes, sceneOrigin)
      }

      // 7a. Quest lifecycle: open/progress/close named undertakings from
      // the fiction. Matched by name (case-insensitive) like NPCs/factions.
      if (world_updates.quest_changes) {
        await applyQuestChanges(tx, campaignId, currentTurnNumber, world_updates.quest_changes)
      }

      // 7a-bis. Corruption bargain offers: persist so the character's NEXT
      // action can mechanically invoke them (see resolution.ts surge).
      // Live scenes only — an offscreen tick can't put an offer in front
      // of a player — and only in campaigns that actually have a theme.
      if (sceneOrigin && world_updates.bargain_offers && world_updates.bargain_offers.length > 0) {
        await applyBargainOffers(tx, campaignId, currentTurnNumber, world_updates.bargain_offers, getCorruptionTheme)
      }

      // 8. Store GM notes in WorldMeta if provided
      if (world_updates.notes_for_gm) {
        await storeGmNotesForTurn(tx, campaignId, currentTurnNumber, world_updates.notes_for_gm)
      }
    })

    console.log('✅ All world updates applied successfully')

    return { involvedNpcIds, involvedFactionIds }
  } catch (error) {
    console.error('❌ Failed to apply world updates:', error)
    throw new Error(`Failed to apply world updates: ${error}`)
  }
}

/**
 * Check for completed clocks and create consequence events
 * Called during world turns
 *
 * @param campaignId - Campaign to check
 * @returns Array of completed clocks
 */
export async function checkAndResolveCompletedClocks(
  campaignId: string,
  currentTurnNumber: number
): Promise<any[]> {
  console.log('🔍 Checking for completed clocks...')

  const completedClocks = await prisma.clock.findMany({
    where: {
      campaignId,
      currentTicks: { gte: prisma.clock.fields.maxTicks },
      resolvedAt: null
    }
  })

  if (completedClocks.length === 0) {
    console.log('  No completed clocks')
    return []
  }

  console.log(`⏰ ${completedClocks.length} clock(s) completed!`)

  // Create timeline events for each completed clock
  for (const clock of completedClocks) {
    // Ambition-sourced clocks (see ambitionTick.ts) get their real
    // success/failure outcome narrated by worldTurn.ts's
    // resolveCompletedAmbitions instead of this generic flavor-text event —
    // it knows whether the ambition actually succeeded, this doesn't.
    if (!clock.sourceFactionId) {
      await prisma.timelineEvent.create({
        data: {
          campaignId,
          turnNumber: currentTurnNumber,
          title: `${clock.name} - Complete!`,
          summaryPublic: clock.consequence,
          summaryGM: `Clock "${clock.name}" reached ${clock.maxTicks} ticks. ${clock.gmNotes}`,
          isOffscreen: true,
          visibility: clock.isHidden ? 'GM_ONLY' : 'PUBLIC'
        }
      })

      console.log(`  ⏰ Created event for: ${clock.name}`)
    }

    await prisma.clock.update({
      where: { id: clock.id },
      data: { resolvedAt: new Date() }
    })
  }

  return completedClocks
}

/**
 * Simple helper to log what changed
 * Useful for debugging and admin views
 */
export function summarizeWorldUpdates(aiResponse: AIGMResponse): string {
  const updates = aiResponse.world_updates
  const summary: string[] = []

  if (updates.new_timeline_events?.length) {
    summary.push(`${updates.new_timeline_events.length} new timeline events`)
  }

  if (updates.clock_changes?.length) {
    summary.push(`${updates.clock_changes.length} clock changes`)
  }

  if (updates.npc_changes?.length) {
    summary.push(`${updates.npc_changes.length} NPC updates`)
  }

  if (updates.pc_changes?.length) {
    summary.push(`${updates.pc_changes.length} character updates`)
  }

  if (updates.faction_changes?.length) {
    summary.push(`${updates.faction_changes.length} faction updates`)
  }

  if (updates.notes_for_gm) {
    summary.push('GM notes recorded')
  }

  return summary.length > 0
    ? summary.join(', ')
    : 'No world changes'
}

/**
 * Enrich stub factions auto-created mid-campaign with no description.
 * Mirror of enrichStubNPCs — same pattern, same non-critical fire-and-forget usage.
 */
export async function enrichStubFactions(
  campaignId: string,
  sceneText: string
): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return

  const cutoff = new Date(Date.now() - 2 * 60 * 1000)
  const stubs = await prisma.faction.findMany({
    where: {
      campaignId,
      description: '',
      createdAt: { gte: cutoff }
    },
    select: { id: true, name: true }
  })

  if (stubs.length === 0) return

  console.log(`🪄 Enriching ${stubs.length} stub faction(s): ${stubs.map(f => f.name).join(', ')}`)

  const nameList = stubs.map(f => `- ${f.name}`).join('\n')
  const prompt = `You are a TTRPG game master. The following scene just resolved:\n\n${sceneText}\n\nThese factions or groups were introduced for the first time:\n${nameList}\n\nFor each faction, write a SHORT 1-2 sentence description (what they are, their role or agenda) based on context from the scene. Invent something consistent with the fiction if they aren't explicitly described.\n\nRespond with valid JSON:\n{"factions": [{"name": "...", "description": "...", "goals": "..."}]}`

  const startTime = Date.now()
  try {
    const response = await openaiFetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: AI_MODELS.EFFICIENT,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 400,
        response_format: { type: 'json_object' }
      })
    })

    if (!response.ok) {
      console.warn('⚠️ Faction enrichment API call failed:', response.status)
      return
    }

    const data = await response.json()
    const rawContent = data.choices[0].message.content
    const parsed = JSON.parse(rawContent) as {
      factions: Array<{ name: string; description: string; goals?: string }>
    }

    const usage = data.usage || {}
    await recordAICost({
      campaignId,
      model: AI_MODELS.EFFICIENT,
      requestType: 'faction_enrichment',
      inputTokens: usage.prompt_tokens || estimateTokenCount(prompt),
      outputTokens: usage.completion_tokens || estimateTokenCount(rawContent),
      responseTimeMs: Date.now() - startTime,
      success: true
    }).catch(console.error)

    for (const enriched of parsed.factions) {
      const stub = stubs.find(f => f.name.toLowerCase() === enriched.name.toLowerCase())
      if (stub && enriched.description) {
        await prisma.faction.update({
          where: { id: stub.id },
          data: {
            description: enriched.description,
            ...(enriched.goals ? { goals: enriched.goals } : {})
          }
        })
        console.log(`  ✅ Enriched faction: ${stub.name}`)
      }
    }
  } catch (err) {
    console.warn('⚠️ Faction enrichment failed (non-critical):', err)
  }
}

/**
 * Enrich stub NPCs that were auto-created mid-scene with no description.
 *
 * After `applyWorldUpdates` commits, any NPC introduced by the AI without
 * a description exists as a bare name in the DB.  This function makes a
 * single lightweight AI call to flesh them out based on the resolved scene
 * text, then persists the result.
 *
 * Silently skips if OpenAI is unconfigured or returns an error — it is
 * intentionally non-critical.
 */
export async function enrichStubNPCs(
  campaignId: string,
  sceneText: string
): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return

  // Find NPCs created in the last 2 minutes with no description
  const cutoff = new Date(Date.now() - 2 * 60 * 1000)
  const stubs = await prisma.nPC.findMany({
    where: {
      campaignId,
      description: null,
      createdAt: { gte: cutoff }
    },
    select: { id: true, name: true }
  })

  if (stubs.length === 0) return

  console.log(`🪄 Enriching ${stubs.length} stub NPC(s): ${stubs.map(n => n.name).join(', ')}`)

  const nameList = stubs.map(n => `- ${n.name}`).join('\n')
  const prompt = `You are a TTRPG game master. The following scene just resolved:\n\n${sceneText}\n\nThese NPCs were introduced for the first time:\n${nameList}\n\nFor each NPC, write a SHORT 1-2 sentence description (appearance, role, or personality) based on how they appear in the scene. If the scene doesn't mention them explicitly, invent something consistent with the fiction.\n\nRespond with valid JSON:\n{"npcs": [{"name": "...", "description": "..."}]}`

  const startTime = Date.now()
  try {
    const response = await openaiFetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: AI_MODELS.EFFICIENT,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 400,
        response_format: { type: 'json_object' }
      })
    })

    if (!response.ok) {
      console.warn('⚠️ NPC enrichment API call failed:', response.status)
      return
    }

    const data = await response.json()
    const rawContent = data.choices[0].message.content
    const parsed = JSON.parse(rawContent) as {
      npcs: Array<{ name: string; description: string }>
    }

    const usage = data.usage || {}
    await recordAICost({
      campaignId,
      model: AI_MODELS.EFFICIENT,
      requestType: 'npc_enrichment',
      inputTokens: usage.prompt_tokens || estimateTokenCount(prompt),
      outputTokens: usage.completion_tokens || estimateTokenCount(rawContent),
      responseTimeMs: Date.now() - startTime,
      success: true
    }).catch(console.error)

    for (const enriched of parsed.npcs) {
      const stub = stubs.find(s => s.name.toLowerCase() === enriched.name.toLowerCase())
      if (stub && enriched.description) {
        await prisma.nPC.update({
          where: { id: stub.id },
          data: { description: enriched.description }
        })
        console.log(`  ✅ Enriched NPC: ${stub.name}`)
      }
    }
  } catch (err) {
    console.warn('⚠️ NPC enrichment failed (non-critical):', err)
  }
}
