// src/app/api/internal/cron/world-tick-sweep/route.ts
// Daily Vercel Cron entry point (see vercel.json's `crons`) — the piece
// that makes "the world moves even when nobody's playing" structurally
// true. Before this, every world-turn check was piggybacked on player
// HTTP traffic; a campaign nobody visited simply never got checked again.
// Secured via Vercel's own cron-auth convention: when CRON_SECRET is set,
// Vercel invokes this route with `Authorization: Bearer $CRON_SECRET`.

import { NextRequest, NextResponse } from 'next/server'
import { pruneCampaignHistory } from '@/lib/game/retention'
import { sweepWorldTurnsForAllCampaigns } from '@/lib/game/worldTurnSweep'
import { sweepGloballyStuckResolutionJobs } from '@/lib/game/resolutionQueue'
import { TurnTracker } from '@/lib/notifications/turn-tracker'
import { reportError } from '@/lib/monitoring'

// Hobby-plan-safe, and the number the sweep's own duration budget is
// derived from — SWEEP_DURATION_BUDGET_MS in worldTurnSweep.ts. Raising
// one without the other puts them back out of step, which is #503: the
// sweep's cap was a count of 25 turns at ~20s each, authorised inside a
// 60-second invocation, so the sweep did not stop when it ran long, it got
// killed mid-turn.
export const maxDuration = 60

/**
 * Every non-fatal step below logs and continues, which is right — one
 * failing sweep must not cost the others. But #492: "logs and continues"
 * used to mean the ONLY record was a console line in a drain nobody reads.
 * This is a daily unattended job with no human watching it run; if it
 * quietly stops doing half its work, the first symptom is a player noticing
 * their world stopped moving.
 *
 * So each step now also alerts. Awaited rather than fire-and-forget here,
 * unlike the API-route path: nothing is waiting on this response, and a
 * serverless invocation that returns can have its pending work cut off
 * mid-flight.
 */
async function nonFatal(context: string, error: unknown): Promise<void> {
  console.error(`Cron: ${context} (non-fatal):`, error)
  await reportError(`cron-${context}`, error)
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Bonus: this was also purely traffic-piggybacked before — a stuck
  // resolution job in a campaign nobody revisits could sit stuck forever.
  await sweepGloballyStuckResolutionJobs().catch(err => nonFatal('stuck-job-sweep', err))

  // Turn-tracker upkeep (#6/#52). Both functions were fully implemented
  // with zero callers, so the countdown the TurnTracker UI renders visibly
  // hit zero and did nothing at all.
  //
  // Neither of these changes the turn queue's advisory-only design.
  // checkExpiredTurns is already gated on `autoAdvanceTurn`, which nothing
  // currently sets true — so it's a no-op today and only ever acts on a
  // tracker that has explicitly opted in. sendPeriodicReminders just
  // nudges; nudging is exactly what an advisory queue should do when a
  // deadline is approaching.
  await TurnTracker.sendPeriodicReminders().catch(err => nonFatal('turn-reminders', err))
  const autoAdvanced = await TurnTracker.checkExpiredTurns().catch(async err => {
    await nonFatal('expired-turn-sweep', err)
    return 0
  })
  if (autoAdvanced) {
    console.log(`⏭️  Cron: auto-advanced ${autoAdvanced} expired turn(s)`)
  }
  // #320: a deadline that passes with autoAdvanceTurn: false (the only
  // mode anything currently sets) used to produce total silence — nothing
  // told the host a scene was stuck waiting on someone past their
  // deadline. This notifies each affected campaign's admins once per
  // deadline (gated on TurnTracker.overdueNotifiedAt, cleared whenever a
  // new deadline is set), not every sweep.
  const overdueNotified = await TurnTracker.notifyOverdueTurns().catch(async err => {
    await nonFatal('overdue-turn-notifications', err)
    return 0
  })
  if (overdueNotified) {
    console.log(`⏸️  Cron: notified hosts of ${overdueNotified} overdue turn(s)`)
  }

  // The sweep itself is the job. A throw here means the world did not move
  // for anyone today, which is the single loudest thing this route can
  // have to say — so it alerts and returns a 500 rather than letting the
  // invocation succeed with a body describing nothing.
  let result
  try {
    result = await sweepWorldTurnsForAllCampaigns()
  } catch (error) {
    console.error('Cron: world-turn sweep failed:', error)
    await reportError('cron-world-turn-sweep-failed', error)
    return NextResponse.json({ error: 'World-turn sweep failed' }, { status: 500 })
  }
  console.log(
    `🌍 Cron world-turn sweep: ${result.ticked}/${result.campaignsChecked} campaigns ticked, ` +
    `${result.failed} failed, ${result.skippedAtCap} deferred at the cap, ` +
    `${result.skippedOutOfTime} deferred out of time`
  )

  // #408: prune the oldest event history for whatever this sweep actually
  // ticked.
  //
  // Eighteen append-only tables had zero delete sites between them, and
  // WorldEvent is not merely storage — beliefTick/npcDispositionTick derive
  // drift by COUNTING prior-turn rows, so it is a hot read path whose cost
  // grows monotonically for the life of a campaign.
  //
  // Scoped to campaigns that ticked, and bounded per campaign, so pruning
  // rides the same cadence as the growth it offsets instead of becoming a
  // second unbounded pass inside a cron invocation that already has a
  // duration budget. Best-effort throughout: retention must never be the
  // reason a world turn's own result is lost.
  let prunedRows = 0
  for (const campaignId of result.tickedCampaignIds) {
    try {
      const pruned = await pruneCampaignHistory(campaignId)
      prunedRows +=
        pruned.worldEventsDeleted +
        pruned.eventWitnessesDeleted +
        pruned.diceRollsDeleted +
        pruned.aiCostEntriesDeleted
    } catch (err) {
      await nonFatal(`retention-pass (campaign ${campaignId})`, err)
    }
  }
  if (prunedRows > 0) {
    console.log(`🧹 Cron: pruned ${prunedRows} row(s) of aged history`)
  }

  return NextResponse.json({ ...result, prunedRows })
}
