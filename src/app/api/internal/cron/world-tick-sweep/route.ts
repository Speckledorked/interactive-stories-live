// src/app/api/internal/cron/world-tick-sweep/route.ts
// Daily Vercel Cron entry point (see vercel.json's `crons`) — the piece
// that makes "the world moves even when nobody's playing" structurally
// true. Before this, every world-turn check was piggybacked on player
// HTTP traffic; a campaign nobody visited simply never got checked again.
// Secured via Vercel's own cron-auth convention: when CRON_SECRET is set,
// Vercel invokes this route with `Authorization: Bearer $CRON_SECRET`.

import { NextRequest, NextResponse } from 'next/server'
import { sweepWorldTurnsForAllCampaigns } from '@/lib/game/worldTurnSweep'
import { sweepGloballyStuckResolutionJobs } from '@/lib/game/resolutionQueue'

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

  const result = await sweepWorldTurnsForAllCampaigns()
  console.log(
    `🌍 Cron world-turn sweep: ${result.ticked}/${result.campaignsChecked} campaigns ticked, ` +
    `${result.failed} failed, ${result.skippedAtCap} deferred to tomorrow`
  )

  return NextResponse.json(result)
}
