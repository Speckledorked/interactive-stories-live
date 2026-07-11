// src/lib/game/worldTurn.ts
// Background world turn system
// This runs AFTER scenes resolve to advance villain plans and clocks

import { prisma } from '@/lib/prisma'
import { callAIForWorldTurn } from '@/lib/ai/client'
import { buildWorldSummaryForAI } from '@/lib/ai/worldState'
import { applyWorldUpdates, checkAndResolveCompletedClocks } from './stateUpdater'
import { runWorldTick } from './worldTick'
import { createCampaignMemory } from '@/lib/ai/memoryCreation'
import { EventVisibility } from '@prisma/client'
import { PendingAmbition } from './tick/types'
import { AMBITION_CATEGORY_OPTIONS } from './tick/ambitionTick'

/**
 * Run a world turn - advance clocks and generate background events
 * This simulates the world moving forward independent of player actions
 * 
 * @param campaignId - Campaign to advance
 */
export async function runWorldTurn(campaignId: string) {
  console.log('🌍 Running world turn...')

  const worldMeta = await prisma.worldMeta.findUnique({
    where: { campaignId }
  })

  if (!worldMeta) {
    throw new Error('WorldMeta not found')
  }

  const currentTurn = worldMeta.currentTurnNumber

  try {
    // 0. World Sim Phase 1: deterministic tick — NPCs, factions, weather.
    // Pure and AI-free by design; it decides what changed and why. Only the
    // narration below (and the AI GM prompt builder) turns that into prose.
    console.log('🧭 Running world tick (NPCs, factions, weather)...')
    const worldTick = await runWorldTick(campaignId, currentTurn)
    console.log(`  🧭 World tick: ${worldTick.changes.length} change(s), ${worldTick.historyEntriesCreated} logged to history`)

    // 1. Advance clocks based on faction tags
    console.log('⏰ Advancing clocks...')
    const advancedClocks = await advanceClocks(campaignId)

    // 2. Check for completed clocks
    console.log('🔍 Checking completed clocks...')
    const completedClocks = await checkAndResolveCompletedClocks(campaignId, currentTurn)

    // 2b. Major NPCs whose goal just completed this tick — these need AI
    // narration of the outcome and a new goal (see NPC_GOAL_COMPLETED
    // handling in generateOffscreenEvents), same trigger shape as clocks.
    const completedGoalNpcs = worldTick.changes
      .filter((c) => c.entityType === 'NPC' && c.field === 'goalCompleted')
      .map((c) => ({ npcId: c.entityId, npcName: c.entityName, completedGoal: c.previousValue }))

    // 3. Generate offscreen events with AI (if there's interesting clock or NPC activity)
    if (advancedClocks.length > 0 || completedClocks.length > 0 || completedGoalNpcs.length > 0 || worldTick.pendingAmbitions.length > 0) {
      console.log('🤖 Generating offscreen events...')
      await generateOffscreenEvents(campaignId, currentTurn, advancedClocks, completedClocks, completedGoalNpcs, worldTick.pendingAmbitions)
    } else {
      console.log('  No significant clock or NPC activity - skipping offscreen events')
    }

    // 4. Update in-game date (simple progression)
    await advanceInGameDate(campaignId)

    console.log('✅ World turn complete')

    return {
      success: true,
      clocksAdvanced: advancedClocks.length,
      clocksCompleted: completedClocks.length,
      worldTickChanges: worldTick.changes.length,
      worldTickHistoryEntries: worldTick.historyEntriesCreated
    }
  } catch (error) {
    console.error('❌ World turn failed:', error)
    throw error
  }
}

/**
 * Advance clocks based on simple rules
 * This uses faction/clock tags to determine how fast they tick
 */
async function advanceClocks(campaignId: string) {
  console.log('  Fetching active clocks...')

  const clocks = await prisma.clock.findMany({
    where: {
      campaignId,
      currentTicks: { lt: prisma.clock.fields.maxTicks } // Not completed
    }
  })

  const advancedClocks: any[] = []

  for (const clock of clocks) {
    // Determine advance rate based on clock category or random chance
    let advanceAmount = 0

    // Note: Clock-faction relations are not in the current schema
    // Using a simple random-based advancement instead
    if (clock.category === 'urgent') {
      advanceAmount = 1 // Always advance urgent clocks
    } else if (clock.category === 'slow') {
      advanceAmount = Math.random() > 0.8 ? 1 : 0 // 20% chance
    } else {
      // Default clocks advance at medium rate
      advanceAmount = Math.random() > 0.6 ? 1 : 0 // 40% chance
    }

    if (advanceAmount > 0) {
      const newTicks = Math.min(clock.currentTicks + advanceAmount, clock.maxTicks)

      await prisma.clock.update({
        where: { id: clock.id },
        data: { currentTicks: newTicks }
      })

      console.log(`  ⏰ ${clock.name}: ${clock.currentTicks} → ${newTicks}`)

      advancedClocks.push({
        id: clock.id,
        name: clock.name,
        oldTicks: clock.currentTicks,
        newTicks,
        category: clock.category
      })
    }
  }

  console.log(`  Advanced ${advancedClocks.length} clock(s)`)
  return advancedClocks
}

/**
 * Generate offscreen events using AI
 * These are things happening in the background
 */
async function generateOffscreenEvents(
  campaignId: string,
  currentTurn: number,
  advancedClocks: any[],
  completedClocks: any[],
  completedGoalNpcs: Array<{ npcId: string; npcName: string; completedGoal: string | number }> = [],
  pendingAmbitions: PendingAmbition[] = []
) {
  try {
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId }
    })

    if (!campaign) {
      throw new Error('Campaign not found')
    }

    // Build world summary
    const { worldSummary } = await buildWorldSummaryForAI(campaignId)

    // Recent ambition names (regardless of which faction spawned them) so the
    // AI doesn't repeat "Thornburg Guild Grand Tournament" for the third time
    // in a row — just enough context to vary itself, not a hard exclusion list.
    let recentAmbitionNames: string[] = []
    if (pendingAmbitions.length > 0) {
      const recentAmbitionClocks = await prisma.clock.findMany({
        where: { campaignId, sourceFactionId: { not: null } },
        select: { name: true },
        orderBy: { createdAt: 'desc' },
        take: 10,
      })
      recentAmbitionNames = recentAmbitionClocks.map((c) => c.name)
    }

    // Call AI to generate offscreen events
    const aiResult = await callAIForWorldTurn(
      campaign.universe || 'Generic Fantasy',
      campaign.aiSystemPrompt,
      worldSummary,
      [...advancedClocks, ...completedClocks],
      campaignId,
      completedGoalNpcs,
      pendingAmbitions.map((a) => ({ factionId: a.factionId, factionName: a.factionName, goal: a.goal })),
      recentAmbitionNames
    )

    // Turn each pending ambition into a real Clock — the tick already decided
    // WHETHER; this resolves WHAT using the AI's pick if it gave one and is
    // actually one of the bounded options for that faction's goal, otherwise
    // the deterministic fallback so the ambition never silently disappears.
    for (const pending of pendingAmbitions) {
      const validOptions = AMBITION_CATEGORY_OPTIONS[pending.goal as 'ENRICH' | 'EXPAND'] || []
      const pick = aiResult.ambition_picks?.find((p) => p.faction_id === pending.factionId)
      const useAiPick = !!pick && validOptions.includes(pick.category)

      const name = useAiPick ? pick!.name : pending.fallbackName
      const description = useAiPick ? (pick!.description || pending.fallbackConsequence) : pending.fallbackConsequence
      const category = useAiPick ? pick!.category : pending.category

      await prisma.clock.create({
        data: {
          campaignId,
          name,
          description,
          category,
          maxTicks: pending.maxTicks,
          currentTicks: 0,
          consequence: pending.fallbackConsequence,
          sourceFactionId: pending.factionId,
        },
      })

      console.log(`  🎯 ${pending.factionName} committed to: ${name}${useAiPick ? '' : ' (fallback)'}`)
    }

    // Create timeline events for each offscreen event
    const createdEvents: { id: string; title: string; summary_gm: string }[] = []
    for (const event of aiResult.offscreen_events) {
      const created = await prisma.timelineEvent.create({
        data: {
          campaignId,
          turnNumber: currentTurn,
          title: event.title,
          summaryPublic: event.summary_public,
          summaryGM: event.summary_gm,
          isOffscreen: true,
          visibility: 'MIXED' as EventVisibility // Players see public, GM sees full
        }
      })
      createdEvents.push({ id: created.id, title: event.title, summary_gm: event.summary_gm })

      console.log(`  📰 Created offscreen event: ${event.title}`)
    }

    // Apply any structured consequences (new/updated NPCs, faction changes)
    // through the same path scene resolution uses, so a named outcome (a
    // tournament winner, a new rival) becomes a real, queryable entity —
    // not just a sentence in the event summary above.
    let involvedNpcIds: string[] = []
    let involvedFactionIds: string[] = []
    const hasWorldUpdates =
      (aiResult.world_updates?.npc_changes?.length || 0) > 0 ||
      (aiResult.world_updates?.faction_changes?.length || 0) > 0

    if (hasWorldUpdates) {
      const applied = await applyWorldUpdates(
        campaignId,
        {
          scene_text: '',
          world_updates: {
            npc_changes: aiResult.world_updates?.npc_changes,
            faction_changes: aiResult.world_updates?.faction_changes,
          },
        },
        currentTurn
      )
      involvedNpcIds = applied.involvedNpcIds
      involvedFactionIds = applied.involvedFactionIds
      console.log(`  🌍 Applied offscreen world updates: ${involvedNpcIds.length} NPC(s), ${involvedFactionIds.length} faction(s) touched`)
    }

    // Embed each offscreen event into campaign memory so it's retrievable
    // by semantic search indefinitely, not just while it's within the last
    // ~10-20 timeline events the prompt builder includes directly. This is
    // what lets a player ask "who won the tournament?" turns later and get
    // the real answer instead of the AI improvising a fresh one.
    for (const event of createdEvents) {
      await createCampaignMemory({
        campaignId,
        memoryType: 'WORLD_EVENT',
        sourceId: event.id,
        turnNumber: currentTurn,
        title: event.title,
        summary: event.summary_gm,
        fullContext: event.summary_gm,
        involvedCharacterIds: [],
        involvedNpcIds,
        involvedFactionIds,
        locationTags: [],
        importance: 'NORMAL',
        tags: ['offscreen_event', 'world_turn'],
      }).catch(err => console.error(`  ⚠️ Failed to embed memory for offscreen event "${event.title}":`, err))
    }

    // Store GM notes
    if (aiResult.gm_notes) {
      const worldMeta = await prisma.worldMeta.findUnique({
        where: { campaignId }
      })

      if (worldMeta) {
        const currentMeta = worldMeta.otherMeta as any || {}
        const worldTurnNotes = currentMeta.world_turn_notes || []

        worldTurnNotes.push({
          turn: currentTurn,
          notes: aiResult.gm_notes,
          timestamp: new Date().toISOString()
        })

        // Keep only last 10 turns
        if (worldTurnNotes.length > 10) {
          worldTurnNotes.shift()
        }

        await prisma.worldMeta.update({
          where: { id: worldMeta.id },
          data: {
            otherMeta: {
              ...currentMeta,
              world_turn_notes: worldTurnNotes
            }
          }
        })
      }
    }

    console.log(`  ✅ Generated ${aiResult.offscreen_events.length} offscreen event(s)`)
  } catch (error) {
    console.error('  ⚠️ Failed to generate offscreen events:', error)
    // Don't throw - world turn can continue without AI-generated events
  }
}

/**
 * Advance the in-game date
 * Simple version - just increments by days
 */
async function advanceInGameDate(campaignId: string) {
  const worldMeta = await prisma.worldMeta.findUnique({
    where: { campaignId }
  })

  if (!worldMeta) {
    return
  }

  // Parse current date (assumes format like "Day 1", "Day 2", etc.)
  const currentDate = worldMeta.currentInGameDate || 'Day 1'
  const dayMatch = currentDate.match(/Day (\d+)/)

  if (dayMatch) {
    const currentDay = parseInt(dayMatch[1])
    const newDate = `Day ${currentDay + 1}`

    await prisma.worldMeta.update({
      where: { id: worldMeta.id },
      data: { currentInGameDate: newDate }
    })

    console.log(`  📅 Date advanced: ${currentDate} → ${newDate}`)
  }
}

/**
 * Get world turn summary for display
 * Shows what happened during background processing
 */
export async function getWorldTurnSummary(campaignId: string) {
  const worldMeta = await prisma.worldMeta.findUnique({
    where: { campaignId }
  })

  if (!worldMeta) {
    return null
  }

  const otherMeta = worldMeta.otherMeta as any || {}
  const worldTurnNotes = otherMeta.world_turn_notes || []

  // Get recent offscreen events
  const offscreenEvents = await prisma.timelineEvent.findMany({
    where: {
      campaignId,
      isOffscreen: true
    },
    orderBy: { turnNumber: 'desc' },
    take: 5
  })

  return {
    currentTurn: worldMeta.currentTurnNumber,
    currentDate: worldMeta.currentInGameDate,
    recentNotes: worldTurnNotes.slice(-3), // Last 3 turns
    recentOffscreenEvents: offscreenEvents
  }
}

/**
 * Manually trigger a world turn
 * Useful for testing or when admin wants to advance the world
 */
export async function manualWorldTurn(campaignId: string, userId: string) {
  // Verify user is admin
  const membership = await prisma.campaignMembership.findUnique({
    where: {
      userId_campaignId: {
        userId,
        campaignId
      }
    }
  })

  if (membership?.role !== 'ADMIN') {
    throw new Error('Only admins can trigger world turns')
  }

  return runWorldTurn(campaignId)
}
