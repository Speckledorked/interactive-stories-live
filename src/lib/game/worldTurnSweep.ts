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
}

export async function sweepWorldTurnsForAllCampaigns(): Promise<WorldTurnSweepResult> {
  const now = new Date()
  const campaigns = await prisma.campaign.findMany({
    where: { isActive: true, worldMeta: { isNot: null } },
    // #282: without this, campaigns come back in Postgres's natural scan
    // order — stable and unrelated to how overdue any of them are — so
    // the same ~25 campaigns (MAX_TURNS_PER_SWEEP) win the cap every
    // single day, permanently starving anything sorting past that
    // position as the platform's campaign count grows. Ordering
    // most-overdue-first instead means whichever campaigns get ticked
    // today have their hoursSinceWorldTurn reset back down (worldTurn.ts),
    // which naturally rotates them out of the front of tomorrow's queue —
    // no separate cursor to persist, the accumulator IS the fairness
    // state.
    orderBy: { worldMeta: { hoursSinceWorldTurn: 'desc' } },
    select: {
      id: true,
      worldMeta: { select: { lastRealTimeTickAt: true, hoursBankedSinceLastHeartbeat: true } },
    },
  })

  let ticked = 0
  let failed = 0
  let processed = 0
  let skippedAtCap = 0
  const bankedOk = new Set<string>()

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
        } catch (error) {
          failed++
          console.error(`World-turn sweep banking failed for campaign ${campaign.id}:`, error)
        }
      })
    )
  }

  // Turn-ticking stays fully sequential and capped: each tick can make real
  // AI calls, so running these concurrently would multiply cost-control
  // and rate-limit risk for no real duration benefit — MAX_TURNS_PER_SWEEP
  // already bounds this phase's total work far below banking's.
  for (const campaign of campaigns) {
    if (!bankedOk.has(campaign.id)) continue
    if (processed >= MAX_TURNS_PER_SWEEP) {
      skippedAtCap++
      continue
    }
    processed++
    try {
      const { ran } = await runWorldTurnIfDue(campaign.id)
      if (ran) ticked++
    } catch (error) {
      failed++
      console.error(`World-turn sweep tick failed for campaign ${campaign.id}:`, error)
    }
  }

  return { campaignsChecked: campaigns.length, ticked, failed, skippedAtCap }
}
