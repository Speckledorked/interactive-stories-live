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

// Hobby-plan-safe. sweepWorldTurnsForAllCampaigns caps how many campaigns
// get a full (AI-calling) world turn per sweep for the same reason.
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Bonus: this was also purely traffic-piggybacked before — a stuck
  // resolution job in a campaign nobody revisits could sit stuck forever.
  await sweepGloballyStuckResolutionJobs().catch(err =>
    console.error('Cron: stuck-job sweep failed (non-fatal):', err)
  )

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
  await TurnTracker.sendPeriodicReminders().catch(err =>
    console.error('Cron: turn reminders failed (non-fatal):', err)
  )
  const autoAdvanced = await TurnTracker.checkExpiredTurns().catch(err => {
    console.error('Cron: expired-turn sweep failed (non-fatal):', err)
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
  const overdueNotified = await TurnTracker.notifyOverdueTurns().catch(err => {
    console.error('Cron: overdue-turn notification sweep failed (non-fatal):', err)
    return 0
  })
  if (overdueNotified) {
    console.log(`⏸️  Cron: notified hosts of ${overdueNotified} overdue turn(s)`)
  }

  const result = await sweepWorldTurnsForAllCampaigns()
  console.log(
    `🌍 Cron world-turn sweep: ${result.ticked}/${result.campaignsChecked} campaigns ticked, ` +
    `${result.failed} failed, ${result.skippedAtCap} deferred to tomorrow`
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
      console.error(`Cron: retention pass failed for campaign ${campaignId} (non-fatal):`, err)
    }
  }
  if (prunedRows > 0) {
    console.log(`🧹 Cron: pruned ${prunedRows} row(s) of aged history`)
  }

  return NextResponse.json({ ...result, prunedRows })
}
