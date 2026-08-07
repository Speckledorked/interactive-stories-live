// src/lib/game/worldTurn.ts
// Background world turn system
// This runs AFTER scenes resolve to advance villain plans and clocks

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { checkAndResolveCompletedClocks } from './stateUpdater'
import { runWorldTick } from './worldTick'
import { consolidateOldMemories } from '@/lib/ai/memoryConsolidation'
import { resolveWorldTurnHours, decideWorldTurnPacing } from './tick/pacing'
import { advanceClocks, decideClockAdvancement } from './tick/clockTick'
import type { FactionForClockAdvancement } from './tick/clockTick'
import { resolveCompletedAmbitions } from './tick/ambitionResolution'
import { resolveGenericClockEffects } from './tick/clockResolutionEffects'
import { applyNpcGoalFallbacks } from './tick/npcGoalFallback'
import { generateOffscreenEvents } from './worldTurnOffscreenEvents'
import { sendWorldDigest } from '@/lib/notifications/world-digest'
import { buildChronicleNarrationInput, deriveChronicleGlance } from './chronicleContext'
import { generateChronicleNarration } from '@/lib/ai/chronicleNarration'

// Re-exported for existing importers (see __tests__/worldTurn.test.ts) —
// the pure decider now lives beside advanceClocks in tick/clockTick.ts,
// matching every other tick module's "decide* + handler" shape.
export { decideClockAdvancement }
export type { FactionForClockAdvancement }

/**
 * Run a world turn only if enough IN-GAME time has accumulated since the
 * last one (see lib/game/tick/pacing.ts — default one fictional day).
 * This is what the resolution pipeline calls: rapid exchanges where mere
 * minutes pass in the fiction no longer advance factions, and a "three
 * days later" beat does. The accumulator reset is an atomic claim
 * (updateMany with a gte guard) so concurrent resolutions can't both run
 * a turn off the same banked hours. Admin force paths still call
 * runWorldTurn directly, bypassing the gate.
 */
export async function runWorldTurnIfDue(campaignId: string): Promise<{ ran: boolean }> {
  const worldMeta = await prisma.worldMeta.findUnique({
    where: { campaignId },
    select: { hoursSinceWorldTurn: true, worldTurnHours: true }
  })
  if (!worldMeta) return { ran: false }

  const threshold = resolveWorldTurnHours(worldMeta)
  const decision = decideWorldTurnPacing(worldMeta.hoursSinceWorldTurn, threshold)
  if (!decision.shouldRun) {
    console.log(`🌍 World turn not due (${worldMeta.hoursSinceWorldTurn.toFixed(1)}h banked of ${threshold}h)`)
    return { ran: false }
  }

  const claimed = await prisma.worldMeta.updateMany({
    where: { campaignId, hoursSinceWorldTurn: { gte: threshold } },
    data: { hoursSinceWorldTurn: decision.remainingHours }
  })
  if (claimed.count === 0) {
    return { ran: false }
  }

  try {
    await runWorldTurn(campaignId)
  } catch (error) {
    // Phase 3: runWorldTick's own writes now roll back cleanly on failure,
    // but runWorldTurn does real work beyond it (clocks, offscreen AI
    // narration, digests) that a transaction can't cover. Either way, the
    // claim above already spent the banked hours — restore exactly what
    // this attempt consumed (not overwrite) so a concurrent resolution's
    // own banked hours in the meantime aren't clobbered, and the next
    // heartbeat retries this turn instead of the hours being silently lost.
    const consumedHours = worldMeta.hoursSinceWorldTurn - decision.remainingHours
    await prisma.worldMeta.update({
      where: { campaignId },
      data: { hoursSinceWorldTurn: { increment: consumedHours } },
    })
    throw error
  }
  return { ran: true }
}

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
  // Which in-game day this world turn's events happened on — see
  // lib/game/calendar.ts. Every writer below stamps its TimelineEvent/
  // CampaignLog rows with this same value so a background tick's events
  // land on the same day regardless of which handler produced them.
  const inGameDayNumber = Math.floor(worldMeta.totalElapsedGameHours / 24)

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
    const completedClocks = await checkAndResolveCompletedClocks(campaignId, currentTurn, inGameDayNumber)

    // 2a. Resolve any ambitions among the clocks that just completed — win
    // or lose, deterministically, so a faction's tournament/campaign/heist
    // actually changes its stats instead of only producing a line of
    // flavor text. Runs before offscreen event generation below so the
    // world summary the AI sees already reflects the real outcome.
    const completedAmbitionClocks = completedClocks.filter((c: any) => c.sourceFactionId)
    if (completedAmbitionClocks.length > 0) {
      await resolveCompletedAmbitions(campaignId, currentTurn, completedAmbitionClocks, inGameDayNumber)
    }

    // 2a-ii. GM/world clocks (no sourceFactionId — not an ambition) get an
    // AI-decided, bounded mechanical follow-through on top of the narrated
    // event checkAndResolveCompletedClocks already created for them above
    // — a completed clock can spawn a continuing clock, dent a real
    // location's condition, or nudge a real faction's stats, instead of
    // only ever producing flavor text. Best-effort per clock; never blocks
    // the turn (see resolveGenericClockEffects's own try/catch).
    const completedGenericClocks = completedClocks.filter((c: any) => !c.sourceFactionId)
    if (completedGenericClocks.length > 0) {
      await resolveGenericClockEffects(campaignId, currentTurn, completedGenericClocks as any)
    }

    // 2b. Major NPCs whose goal just completed this tick — these need AI
    // narration of the outcome and a new goal (see NPC_GOAL_COMPLETED
    // handling in generateOffscreenEvents), same trigger shape as clocks.
    const completedGoalNpcs = worldTick.changes
      .filter((c) => c.entityType === 'NPC' && c.field === 'goalCompleted')
      .map((c) => ({ npcId: c.entityId, npcName: c.entityName, completedGoal: c.previousValue }))

    // 3. Generate offscreen events with AI (if there's interesting clock or NPC activity)
    if (advancedClocks.length > 0 || completedClocks.length > 0 || completedGoalNpcs.length > 0 || worldTick.pendingAmbitions.length > 0) {
      console.log('🤖 Generating offscreen events...')
      await generateOffscreenEvents(campaignId, currentTurn, advancedClocks, completedClocks, completedGoalNpcs, worldTick.pendingAmbitions, inGameDayNumber)
    } else {
      console.log('  No significant clock or NPC activity - skipping offscreen events')
    }

    // 3a. Campaign lobby "World Chronicle": a few sentences of generated
    // atmosphere (weather/faction posture/conflicts/recent happenings),
    // cached on WorldMeta and regenerated once per world turn — never on
    // every page view. Runs unconditionally (unlike offscreen events
    // above, which gate on clock/NPC activity): the world's mood can
    // shift — worse weather, a faction growing bolder, tension rising —
    // even on a turn with no clock/goal completions. Best-effort: a
    // failed/skipped generation just leaves the previous turn's
    // narration in place, same "never block the turn" contract
    // sendWorldDigest below already has.
    try {
      const chronicleInput = await buildChronicleNarrationInput(campaignId)
      if (chronicleInput) {
        // Glance is a pure derivation of chronicleInput — persist it
        // unconditionally, independent of whether the AI narration call
        // below succeeds. See deriveChronicleGlance's own doc comment.
        const glance = deriveChronicleGlance(chronicleInput)
        const narration = await generateChronicleNarration(campaignId, chronicleInput)
        await prisma.worldMeta.update({
          where: { campaignId },
          data: {
            chronicleGlance: glance as unknown as Prisma.InputJsonValue,
            ...(narration ? { chronicleNarration: narration, chronicleNarrationTurn: currentTurn } : {}),
          },
        })
      }
    } catch (error) {
      console.error('  ⚠️ Failed to generate chronicle narration:', error)
      // Don't throw — the world turn continues; the lobby just keeps
      // last turn's narration (or none, if there's never been one).
    }

    // 3b. Deterministic fallback for completed NPC goals the AI didn't
    // replace — same guarantee ambitions have (fallbackName/etc in
    // types.ts): a completion never silently goes nowhere. Without this,
    // an AI failure or skip leaves the NPC's goals text unchanged, so the
    // tick re-accrues progress and re-"completes" the identical goal every
    // ~25 turns forever, re-emitting a duplicate MAJOR history event each
    // time. The template goal is bland on purpose — the next AI pass (or
    // scene contact) can overwrite it with something specific.
    if (completedGoalNpcs.length > 0) {
      await applyNpcGoalFallbacks(campaignId, completedGoalNpcs)
    }

    // 4. World-visibility digest: the tick's MAJOR, discovery-safe drama
    // becomes a "word on the street" notification for every member — the
    // living world reaching players instead of running silently. Best
    // effort; never blocks the turn.
    await sendWorldDigest(campaignId, worldTick.changes, currentTurn, inGameDayNumber)

    // 5. Periodically roll up old, low-importance memories so the RAG table
    // doesn't grow unbounded over a long campaign — every 10 turns is often
    // enough to keep it bounded without adding per-turn overhead. Piggybacks
    // on this existing cadence rather than needing a separate cron job.
    let memoriesConsolidated = 0
    if (currentTurn % 10 === 0) {
      const consolidation = await consolidateOldMemories(campaignId, currentTurn)
      memoriesConsolidated = consolidation.memoriesRemoved
    }

    console.log('✅ World turn complete')

    return {
      success: true,
      clocksAdvanced: advancedClocks.length,
      clocksCompleted: completedClocks.length,
      worldTickChanges: worldTick.changes.length,
      worldTickHistoryEntries: worldTick.historyEntriesCreated,
      memoriesConsolidated
    }
  } catch (error) {
    console.error('❌ World turn failed:', error)
    throw error
  }
}

// Deliberately NO manual world-turn trigger, and no admin summary reader
// for one.
//
// Both existed here, exported, with no callers anywhere — a host-facing
// "advance the world now" surface that was built and never connected to
// anything. Removed on purpose rather than wired up, because wiring it was
// the wrong call:
//
//   - The world already moves on its own, twice over: runWorldTurnIfDue
//     when a scene ends, and the daily cron sweep for idle campaigns. Both
//     respect the pacing gate in tick/pacing.ts, which exists precisely
//     because world turns used to fire on every player action.
//   - manualWorldTurn called runWorldTurn DIRECTLY, bypassing that gate.
//     It was a button that overrode a deliberate design decision, spent a
//     metered AI call per press, and had no cooldown.
//   - A world that moves without you is the product. A button that moves
//     it for you undercuts that.
//
// The admin tick PREVIEW (api/campaigns/[id]/world-tick/preview) is
// intentionally read-only and should stay that way. It is not a half-built
// feature missing its apply step — the preview is the whole feature. If
// this ever gets revisited, it needs a cooldown and an explicit cost
// warning before it deserves to exist at all.
