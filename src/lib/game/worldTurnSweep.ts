// src/lib/game/worldTurnSweep.ts
// Orchestration for the daily cron sweep (api/internal/cron/world-tick-sweep).
// For every active campaign: bank real elapsed time into
// hoursSinceWorldTurn (cronHeartbeat.ts) — cheap, always done — then check
// whether that crosses the world-turn threshold. This is the step that
// makes the simulation advance even when nobody's playing; without it,
// runWorldTurnIfDue alone would never find anything due for an idle
// campaign, since its accumulator only otherwise grows from actual play.

import { prisma } from '@/lib/prisma'
import { runWorldTurnIfDue } from './worldTurn'
import { computeHeartbeatBankedHours } from './cronHeartbeat'

// Safety cap on actual world-turn runs (each makes real AI calls) per
// sweep, so one cron invocation can't run past its function-duration
// limit if an unusually large number of campaigns are due at once. Banking
// still happens for every campaign regardless; anything left over is
// still due — and now correctly banked — on tomorrow's sweep.
const MAX_TURNS_PER_SWEEP = 25

// #297: banking runs for every active campaign every sweep, independent of
// MAX_TURNS_PER_SWEEP — a fully sequential await-per-campaign here was a
// real risk of exceeding a serverless function's max duration purely on
// banking, before a single AI-calling turn even ran. Bounded (not
// unbounded) concurrency to avoid opening more simultaneous DB connections
// than the pool can serve, matching loreImportService.ts's existing
// EMBED_BATCH_SIZE convention for the same tradeoff.
const BANKING_BATCH_SIZE = 20

export interface WorldTurnSweepResult {
  campaignsChecked: number
  ticked: number
  failed: number
  skippedAtCap: number
  /**
   * #408: which campaigns actually advanced, so the caller can prune
   * exactly the history this sweep just added to — rather than running a
   * second unbounded pass over every campaign on the platform.
   */
  tickedCampaignIds: string[]
}

export async function sweepWorldTurnsForAllCampaigns(): Promise<WorldTurnSweepResult> {
  const now = new Date()
  const campaigns = await prisma.campaign.findMany({
    where: { isActive: true, worldMeta: { isNot: null } },
    // #282: campaigns must be examined most-overdue-first. Without an
    // ordering they come back in Postgres's natural scan order — stable
    // and unrelated to how overdue any of them are — so the same ~25
    // campaigns win the cap every single day, permanently starving
    // anything sorting past that position as the platform grows.
    //
    // #409: but the sort key CANNOT come from this query. The banking loop
    // below increments hoursSinceWorldTurn for every campaign, and a
    // campaign that missed several sweeps banks the most — so an ordering
    // computed here is computed from values the sweep itself is about to
    // change, and a campaign could end up more overdue than ones ranked
    // above it. The list is re-sorted after banking instead; see below.
    select: {
      id: true,
      worldMeta: { select: { lastRealTimeTickAt: true, hoursBankedSinceLastHeartbeat: true, hoursSinceWorldTurn: true } },
    },
  })

  let ticked = 0
  let failed = 0
  let processed = 0
  let skippedAtCap = 0
  const tickedCampaignIds: string[] = []
  const bankedOk = new Set<string>()
  // #409: post-banking accumulator per campaign — the real overdue-ness,
  // which is what the tick phase must be ordered by.
  const bankedTotals = new Map<string, number>()

  // Banking makes no AI calls and is cheap per-campaign, so it runs in
  // bounded-parallel batches rather than one round-trip at a time — see
  // BANKING_BATCH_SIZE above. A campaign whose banking update fails is
  // excluded from this sweep's turn-tick phase below, matching the
  // original one-loop behavior where a banking failure skipped that
  // campaign's tick too.
  for (let i = 0; i < campaigns.length; i += BANKING_BATCH_SIZE) {
    const batch = campaigns.slice(i, i + BANKING_BATCH_SIZE)
    await Promise.all(
      batch.map(async (campaign) => {
        try {
          const bankedHours = computeHeartbeatBankedHours(
            campaign.worldMeta?.lastRealTimeTickAt ?? null,
            now,
            campaign.worldMeta?.hoursBankedSinceLastHeartbeat ?? 0
          )
          await prisma.worldMeta.update({
            where: { campaignId: campaign.id },
            data: {
              hoursSinceWorldTurn: bankedHours > 0 ? { increment: bankedHours } : undefined,
              lastRealTimeTickAt: now,
              hoursBankedSinceLastHeartbeat: 0,
            },
          })
          bankedOk.add(campaign.id)
          bankedTotals.set(campaign.id, (campaign.worldMeta?.hoursSinceWorldTurn ?? 0) + Math.max(0, bankedHours))
        } catch (error) {
          failed++
          console.error(`World-turn sweep banking failed for campaign ${campaign.id}:`, error)
        }
      })
    )
  }

  // #409: sort AFTER banking, on the values banking produced.
  //
  // The accumulator is the fairness state (see #282), and banking is what
  // moves it — so the ordering has to be read from the post-banking value
  // or the fairness property it exists to provide is applied to stale
  // numbers. `bankedHours` is what each campaign just gained; a campaign
  // whose banking failed keeps its pre-sweep value and is skipped below
  // anyway.
  const overdueOrder = [...campaigns].sort(
    (a, b) => (bankedTotals.get(b.id) ?? 0) - (bankedTotals.get(a.id) ?? 0)
  )

  // Turn-ticking stays fully sequential and capped: each tick can make real
  // AI calls, so running these concurrently would multiply cost-control
  // and rate-limit risk for no real duration benefit — MAX_TURNS_PER_SWEEP
  // already bounds this phase's total work far below banking's.
  for (const campaign of overdueOrder) {
    if (!bankedOk.has(campaign.id)) continue
    if (processed >= MAX_TURNS_PER_SWEEP) {
      skippedAtCap++
      continue
    }
    try {
      const { ran } = await runWorldTurnIfDue(campaign.id)
      if (ran) {
        ticked++
        tickedCampaignIds.push(campaign.id)
        // #409: the cap counts TURNS RUN, not campaigns examined.
        //
        // This used to increment before the call, and runWorldTurnIfDue
        // returns { ran: false } whenever a campaign isn't actually due —
        // so a sweep whose first 25 candidates were all not-yet-due burned
        // the entire cap on no-ops and ticked nothing, while genuinely
        // overdue campaigns further down the list were skipped. The cap
        // exists to bound EXPENSIVE work (a 20s-budgeted transaction plus
        // 2-3 AI completions), and a campaign that isn't due costs one
        // cheap read.
        processed++
      }
    } catch (error) {
      failed++
      console.error(`World-turn sweep tick failed for campaign ${campaign.id}:`, error)
    }
  }

  return { campaignsChecked: campaigns.length, ticked, failed, skippedAtCap, tickedCampaignIds }
}
