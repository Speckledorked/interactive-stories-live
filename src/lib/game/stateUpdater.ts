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

import { Clock } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { AIGMResponse } from '@/lib/ai/client'
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

// Re-exported so existing importers (sceneResolver.ts) don't need to
// change — the implementation lives in stubEnrichment.ts now, see there
// for why the two were merged.
export { enrichStubNPCs, enrichStubFactions } from './stubEnrichment'

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
        const gateRefusals = await applyCharacterChanges(
          tx, campaignId, currentTurnNumber, world_updates.pc_changes, charactersForResolution, getCorruptionTheme, sceneOrigin
        )
        // Corruption gates (#83) refusing a move is a real world event, not
        // a silent no-op — a character the narrator described walking into
        // a shrine did not actually go in, and the log is where that
        // divergence between prose and state is visible.
        for (const refusal of gateRefusals) {
          console.log(`  🌑 ${refusal}`)
        }
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
): Promise<Clock[]> {
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

