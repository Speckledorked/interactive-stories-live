// src/lib/game/worldTurn.ts
// Background world turn system
// This runs AFTER scenes resolve to advance villain plans and clocks

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { TURN_PHASE } from './tick/simulationClock'
import { checkAndResolveCompletedClocks } from './stateUpdater'
import { runWorldTick } from './worldTick'
import { consolidateOldMemories } from '@/lib/ai/memoryConsolidation'
import { resolveWorldTurnHours, decideWorldTurnPacing, leaseIsAvailable, staleLeaseCutoff } from './tick/pacing'
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
 * days later" beat does. Admin force paths still call runWorldTurn
 * directly, bypassing the gate.
 *
 * #376 — the claim is a LEASE, not a rewrite of the accumulator.
 *
 * This used to claim by rewriting hoursSinceWorldTurn under a
 * `gte: threshold` guard, on the theory that spending the banked hours
 * excludes the next claimer. It doesn't: decideWorldTurnPacing caps banked
 * overflow at one threshold, so at acc >= 2*threshold the value written is
 * EXACTLY the threshold and still satisfies `gte`. Since the heartbeat
 * sweep re-banks ~24h/day and the accumulator parks on the boundary after
 * every run, a duplicate concurrent turn was the STEADY STATE for an idle
 * campaign, not a rare race.
 *
 * The two questions are now separate columns: hoursSinceWorldTurn answers
 * "how much fiction time carries forward", worldTurnRunningSince answers
 * "is a run in flight". Both are set in one updateMany, so the claim stays
 * a single atomic compare-and-set — but now the post-state genuinely fails
 * the pre-state predicate, because the lease is non-null.
 *
 * A lease rather than a flag because the holder can be killed (the cron
 * sweep runs against a maxDuration budget); see WORLD_TURN_LEASE_TIMEOUT_MS.
 */
export async function runWorldTurnIfDue(campaignId: string): Promise<{ ran: boolean }> {
  const worldMeta = await prisma.worldMeta.findUnique({
    where: { campaignId },
    select: { hoursSinceWorldTurn: true, worldTurnHours: true, worldTurnRunningSince: true }
  })
  if (!worldMeta) return { ran: false }

  const threshold = resolveWorldTurnHours(worldMeta)
  const decision = decideWorldTurnPacing(worldMeta.hoursSinceWorldTurn, threshold)
  if (!decision.shouldRun) {
    console.log(`🌍 World turn not due (${worldMeta.hoursSinceWorldTurn.toFixed(1)}h banked of ${threshold}h)`)
    return { ran: false }
  }

  const now = new Date()
  if (!leaseIsAvailable(worldMeta.worldTurnRunningSince, now)) {
    console.log(`🌍 World turn already in flight for ${campaignId} (since ${worldMeta.worldTurnRunningSince?.toISOString()})`)
    return { ran: false }
  }

  // The lease predicate is the same test as leaseIsAvailable above,
  // expressed against the row as it is AT WRITE TIME rather than as it was
  // when we read it — that re-check is the whole point of doing it in the
  // update's WHERE rather than in application code.
  const claimed = await prisma.worldMeta.updateMany({
    where: {
      campaignId,
      hoursSinceWorldTurn: { gte: threshold },
      OR: [
        { worldTurnRunningSince: null },
        { worldTurnRunningSince: { lt: staleLeaseCutoff(now) } },
      ],
    },
    data: { hoursSinceWorldTurn: decision.remainingHours, worldTurnRunningSince: now },
  })
  if (claimed.count === 0) {
    return { ran: false }
  }

  try {
    await runWorldTurn(campaignId)
  } catch (error) {
    // runWorldTick's own writes roll back cleanly on failure, but
    // runWorldTurn does real work beyond it (offscreen AI narration,
    // digests, clock advancement in its own transaction) that no single
    // transaction covers — so a failure between commits leaves this turn
    // partially applied. The turn is replay-safe rather than atomic: see
    // WorldEvent.dedupeKey / CampaignMemory.dedupeKey (#377), which make
    // the retry below skip whatever this attempt already wrote instead of
    // duplicating it.
    //
    // The claim above already spent the banked hours — restore exactly
    // what this attempt consumed (not overwrite) so a concurrent
    // resolution's own banked hours in the meantime aren't clobbered, and
    // the next heartbeat retries this turn rather than losing the hours.
    const consumedHours = worldMeta.hoursSinceWorldTurn - decision.remainingHours
    await prisma.worldMeta.update({
      where: { campaignId },
      data: { hoursSinceWorldTurn: { increment: consumedHours } },
    })
    throw error
  } finally {
    // Release only OUR lease. If this run overran the timeout and another
    // process legitimately took the lease over, its stamp is different and
    // this updateMany matches nothing — a slow run must not free the lease
    // out from under its successor.
    await prisma.worldMeta
      .updateMany({
        where: { campaignId, worldTurnRunningSince: now },
        data: { worldTurnRunningSince: null },
      })
      .catch((err: unknown) => {
        // A failed release is self-healing via the staleness timeout, so it
        // must never mask the turn's own outcome.
        console.error('⚠️ Failed to release world-turn lease (self-heals on timeout):', err)
      })
  }
  return { ran: true }
}

/** Record that the in-flight turn reached `phase`. */
async function markTurnPhase(campaignId: string, turnNumber: number, phase: number): Promise<void> {
  await prisma.worldMeta
    .updateMany({
      // Guarded on the turn: if something else has since moved the campaign
      // on, this attempt is stale and must not stamp its watermark over a
      // newer turn's.
      where: { campaignId, turnInFlight: turnNumber },
      data: { turnPhaseCompleted: phase },
    })
    .catch((err: unknown) => {
      // A lost watermark costs a re-run of one idempotent-ish phase on
      // retry, which is strictly better than failing the turn over it.
      console.error(`⚠️ Failed to record turn phase ${phase} (non-critical):`, err)
    })
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

  // #374: the SIMULATION's own clock, not the scene counter.
  //
  // This used to be `worldMeta.currentTurnNumber` — which is written only
  // by sceneResolver.ts, i.e. it counts PLAYER SCENE RESOLUTIONS. This
  // function read it and never wrote it, so a campaign with no players
  // present ran every world turn at the identical turn number. Fourteen
  // handlers consume it as elapsed simulation time, so the consequences
  // were not subtle: weather pinned to a constant, NPC schedules froze or
  // thrashed on `TIME_OF_DAY[turn % 4]`, `age = currentTurn - event.turn`
  // never grew so information never propagated, loans could never mature
  // into default, belief/disposition drift ran exactly once and then
  // no-opped forever, and memory consolidation (gated on `turn % 10`)
  // either never ran or ran on every single turn.
  //
  // simulationTurn advances here and is committed inside runWorldTick's
  // transaction, so it moves if and only if a tick actually happened.
  //
  // #436: a RESUMED turn reuses its own number instead of deriving a new
  // one. simulationTurn commits with the tick, but the turn continues well
  // past that commit — so a failure in any later phase used to leave the
  // counter advanced and send the retry to N+2. Every dedupeKey embeds the
  // turn, so at a fresh number nothing could collide and the retry wrote a
  // second full set of events, doubling the drift derived from counting
  // them. The keys were decoration on exactly the path they were built for.
  //
  // Tested with `typeof === 'number'` rather than `!== null` deliberately.
  // The two failure directions are not symmetric: treating a real in-flight
  // turn as fresh costs a duplicated turn number, while treating a missing
  // value as in-flight would SKIP THE TICK and silently stop the world.
  // Anything that is not a number — an undefined from a partial select, a
  // row written before the column existed — has to mean "not resuming".
  const resuming = typeof worldMeta.turnInFlight === 'number'
  const currentTurn = resuming ? worldMeta.turnInFlight! : worldMeta.simulationTurn + 1

  // How far the in-flight turn already got. Only meaningful when this IS a
  // resume — a fresh turn starts at NOTHING regardless of what the column
  // happens to hold.
  const phaseDone = resuming && typeof worldMeta.turnPhaseCompleted === 'number'
    ? worldMeta.turnPhaseCompleted
    : TURN_PHASE.NOTHING
  if (resuming) {
    console.log(`🔁 Resuming world turn ${currentTurn} from phase ${phaseDone}`)
  }
  // Which in-game day this world turn's events happened on — see
  // lib/game/calendar.ts. Every writer below stamps its TimelineEvent/
  // CampaignLog rows with this same value so a background tick's events
  // land on the same day regardless of which handler produced them.
  const inGameDayNumber = Math.floor(worldMeta.totalElapsedGameHours / 24)

  try {
    // 0. World Sim Phase 1: deterministic tick — NPCs, factions, weather.
    // Pure and AI-free by design; it decides what changed and why. Only the
    // narration below (and the AI GM prompt builder) turns that into prose.
    // #436: the tick applies stat deltas, so re-running it on a resume
    // would double-apply them. Its own transaction already committed, and
    // the WorldEvent rows it wrote are the durable record of what it
    // decided — the phases below that need its output read from `changes`,
    // which a resume deliberately leaves empty rather than recomputing
    // against state the tick has already moved.
    let worldTick: Awaited<ReturnType<typeof runWorldTick>> | null = null
    if (phaseDone < TURN_PHASE.TICK) {
      console.log('🧭 Running world tick (NPCs, factions, weather)...')
      worldTick = await runWorldTick(campaignId, currentTurn)
      console.log(`  🧭 World tick: ${worldTick.changes.length} change(s), ${worldTick.historyEntriesCreated} logged to history`)
    } else {
      console.log('  ⏭️ World tick already committed for this turn — skipping (see TURN_PHASE)')
    }
    const tickChanges = worldTick?.changes ?? []
    const pendingAmbitions = worldTick?.pendingAmbitions ?? []

    // 1. Advance clocks based on faction tags
    let advancedClocks: Awaited<ReturnType<typeof advanceClocks>> = []
    if (phaseDone < TURN_PHASE.CLOCKS_ADVANCED) {
      console.log('⏰ Advancing clocks...')
      advancedClocks = await advanceClocks(campaignId, currentTurn)
      await markTurnPhase(campaignId, currentTurn, TURN_PHASE.CLOCKS_ADVANCED)
    } else {
      console.log('  ⏭️ Clocks already advanced for this turn — skipping')
    }

    // 2. Check for completed clocks
    let completedClocks: Awaited<ReturnType<typeof checkAndResolveCompletedClocks>> = []
    if (phaseDone < TURN_PHASE.CLOCKS_RESOLVED) {
      console.log('🔍 Checking completed clocks...')
      completedClocks = await checkAndResolveCompletedClocks(campaignId, currentTurn, inGameDayNumber)
      await markTurnPhase(campaignId, currentTurn, TURN_PHASE.CLOCKS_RESOLVED)
    } else {
      console.log('  ⏭️ Clocks already resolved for this turn — skipping')
    }

    // 2a. Resolve any ambitions among the clocks that just completed — win
    // or lose, deterministically, so a faction's tournament/campaign/heist
    // actually changes its stats instead of only producing a line of
    // flavor text. Runs before offscreen event generation below so the
    // world summary the AI sees already reflects the real outcome.
    const completedAmbitionClocks = completedClocks.filter((c: any) => c.sourceFactionId)
    if (phaseDone < TURN_PHASE.AMBITIONS_RESOLVED) {
      if (completedAmbitionClocks.length > 0) {
        await resolveCompletedAmbitions(campaignId, currentTurn, completedAmbitionClocks, inGameDayNumber)
      }
      await markTurnPhase(campaignId, currentTurn, TURN_PHASE.AMBITIONS_RESOLVED)
    }

    // 2a-ii. GM/world clocks (no sourceFactionId — not an ambition) get an
    // AI-decided, bounded mechanical follow-through on top of the narrated
    // event checkAndResolveCompletedClocks already created for them above
    // — a completed clock can spawn a continuing clock, dent a real
    // location's condition, or nudge a real faction's stats, instead of
    // only ever producing flavor text. Best-effort per clock; never blocks
    // the turn (see resolveGenericClockEffects's own try/catch).
    const completedGenericClocks = completedClocks.filter((c: any) => !c.sourceFactionId)
    if (phaseDone < TURN_PHASE.GENERIC_CLOCK_EFFECTS) {
      if (completedGenericClocks.length > 0) {
        await resolveGenericClockEffects(campaignId, currentTurn, completedGenericClocks as any)
      }
      await markTurnPhase(campaignId, currentTurn, TURN_PHASE.GENERIC_CLOCK_EFFECTS)
    }

    // 2b. Major NPCs whose goal just completed this tick — these need AI
    // narration of the outcome and a new goal (see NPC_GOAL_COMPLETED
    // handling in generateOffscreenEvents), same trigger shape as clocks.
    const completedGoalNpcs = tickChanges
      .filter((c) => c.entityType === 'NPC' && c.field === 'goalCompleted')
      .map((c) => ({ npcId: c.entityId, npcName: c.entityName, completedGoal: c.previousValue }))

    // 3. Generate offscreen events with AI (if there's interesting clock or NPC activity)
    if (advancedClocks.length > 0 || completedClocks.length > 0 || completedGoalNpcs.length > 0 || pendingAmbitions.length > 0) {
      console.log('🤖 Generating offscreen events...')
      await generateOffscreenEvents(campaignId, currentTurn, advancedClocks, completedClocks, completedGoalNpcs, pendingAmbitions, inGameDayNumber)
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
    await sendWorldDigest(campaignId, tickChanges, currentTurn, inGameDayNumber)

    // 5. Periodically roll up old, low-importance memories so the RAG table
    // doesn't grow unbounded over a long campaign — every 10 turns is often
    // enough to keep it bounded without adding per-turn overhead. Piggybacks
    // on this existing cadence rather than needing a separate cron job.
    //
    // #392: this cadence only became real with #374. It reads
    // `currentTurn % 10`, and currentTurn used to be the scene counter,
    // which does not move on an idle campaign — so consolidation either
    // NEVER ran (frozen on a non-multiple) or ran on EVERY SINGLE world
    // turn (frozen on a multiple). It now counts world turns, which is
    // what "every 10 turns" was always meant to mean.
    let memoriesConsolidated = 0
    if (currentTurn % 10 === 0) {
      const consolidation = await consolidateOldMemories(campaignId, currentTurn)
      memoriesConsolidated = consolidation.memoriesRemoved
    }

    // #436: the turn finished. Clearing the marker is what makes the NEXT
    // turn derive simulationTurn + 1 again — while it is set, every attempt
    // reuses this turn's number so the dedupe keys can do their job.
    await prisma.worldMeta
      .updateMany({
        where: { campaignId, turnInFlight: currentTurn },
        data: { turnInFlight: null, turnPhaseCompleted: TURN_PHASE.NOTHING },
      })
      .catch((err: unknown) => {
        // Left set, the next sweep re-runs this turn's remaining phases —
        // all of which are now watermarked, so it resumes at the end and
        // clears the marker then. Costly, not corrupting.
        console.error('⚠️ Failed to clear the in-flight turn marker (self-heals on the next sweep):', err)
      })

    console.log('✅ World turn complete')

    return {
      success: true,
      clocksAdvanced: advancedClocks.length,
      clocksCompleted: completedClocks.length,
      worldTickChanges: tickChanges.length,
      worldTickHistoryEntries: worldTick?.historyEntriesCreated ?? 0,
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
