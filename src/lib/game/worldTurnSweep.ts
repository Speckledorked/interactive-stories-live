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
    select: { id: true, worldMeta: { select: { lastRealTimeTickAt: true } } },
  })

  let ticked = 0
  let failed = 0
  let processed = 0
  let skippedAtCap = 0

  for (const campaign of campaigns) {
    try {
      const bankedHours = computeHeartbeatBankedHours(campaign.worldMeta?.lastRealTimeTickAt ?? null, now)
      await prisma.worldMeta.update({
        where: { campaignId: campaign.id },
        data: {
          hoursSinceWorldTurn: bankedHours > 0 ? { increment: bankedHours } : undefined,
          lastRealTimeTickAt: now,
        },
      })

      if (processed >= MAX_TURNS_PER_SWEEP) {
        skippedAtCap++
        continue
      }
      processed++
      const { ran } = await runWorldTurnIfDue(campaign.id)
      if (ran) ticked++
    } catch (error) {
      failed++
      console.error(`World-turn sweep failed for campaign ${campaign.id}:`, error)
    }
  }

  return { campaignsChecked: campaigns.length, ticked, failed, skippedAtCap }
}
