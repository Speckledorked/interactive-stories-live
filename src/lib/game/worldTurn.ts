// src/lib/game/worldTurn.ts
// Background world turn system
// This runs AFTER scenes resolve to advance villain plans and clocks

import { prisma } from '@/lib/prisma'
import { callAIForWorldTurn } from '@/lib/ai/client'
import { buildWorldSummaryForAI } from '@/lib/ai/worldState'
import { checkAndResolveCompletedClocks } from './stateUpdater'
import { EventVisibility } from '@prisma/client'

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
    // 1. Advance clocks based on faction tags
    console.log('⏰ Advancing clocks...')
    const advancedClocks = await advanceClocks(campaignId)

    // 2. Check for completed clocks
    console.log('🔍 Checking completed clocks...')
    const completedClocks = await checkAndResolveCompletedClocks(campaignId, currentTurn)

    // 3. Generate offscreen events with AI (if there's interesting clock activity)
    if (advancedClocks.length > 0 || completedClocks.length > 0) {
      console.log('🤖 Generating offscreen events...')
      await generateOffscreenEvents(campaignId, currentTurn, advancedClocks, completedClocks)
    } else {
      console.log('  No significant clock activity - skipping offscreen events')
    }

    // 4. Update in-game date (simple progression)
    await advanceInGameDate(campaignId)

    console.log('✅ World turn complete')

    return {
      success: true,
      clocksAdvanced: advancedClocks.length,
      clocksCompleted: completedClocks.length
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
    },
    include: {
      relatedFaction: true
    }
  })

  const advancedClocks: any[] = []

  for (const clock of clocks) {
    // Determine advance rate based on faction threat level or clock metadata
    let advanceAmount = 0

    if (clock.relatedFaction) {
      // Advance based on faction threat
      switch (clock.relatedFaction.threatLevel) {
        case 'EXTREME':
          advanceAmount = 2 // Fast-moving threats
          break
        case 'HIGH':
          advanceAmount = 1
          break
        case 'MEDIUM':
          advanceAmount = Math.random() > 0.5 ? 1 : 0 // 50% chance
          break
        case 'LOW':
          advanceAmount = Math.random() > 0.7 ? 1 : 0 // 30% chance
          break
      }
    } else {
      // Clocks without factions advance slowly
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
        faction: clock.relatedFaction?.name
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
  completedClocks: any[]
) {
  try {
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId }
    })

    if (!campaign) {
      throw new Error('Campaign not found')
    }

    // Build world summary
    const worldSummary = await buildWorldSummaryForAI(campaignId)

    // Call AI to generate offscreen events
    const aiResult = await callAIForWorldTurn(
      campaign.universe,
      campaign.aiSystemPrompt,
      worldSummary,
      [...advancedClocks, ...completedClocks]
    )

    // Create timeline events for each offscreen event
    for (const event of aiResult.offscreen_events) {
      await prisma.timelineEvent.create({
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

      console.log(`  📰 Created offscreen event: ${event.title}`)
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
  const currentDate = worldMeta.currentInGameDate
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
