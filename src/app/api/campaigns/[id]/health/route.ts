// src/app/api/campaigns/[id]/health/route.ts
//
// Read side for CampaignHealthMonitor (#57).
//
// The monitor already computed a real health score, issue list and
// recommendations every 5 scenes and persisted them to WorldMeta
// (currentHealthScore / campaignHealthHistory / lastHealthCheck) — and
// then only ever console.warn'd the result. 359 lines of genuine analysis
// whose entire audience was a server log nobody reading the product would
// ever see. This exposes what's already stored; it deliberately does NOT
// recompute, so hitting this endpoint costs a single indexed read and
// can't trigger AI usage or move the every-5-scenes cadence.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { needsIntervention, healthBand } from '@/lib/game/campaignHealthBands'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const campaignId = params.id

    const membership = await prisma.campaignMembership.findUnique({
      where: { userId_campaignId: { userId: user.userId, campaignId } },
    })

    if (!membership) {
      return NextResponse.json({ error: 'Not a member of this campaign' }, { status: 403 })
    }

    const worldMeta = await prisma.worldMeta.findUnique({
      where: { campaignId },
      select: {
        currentHealthScore: true,
        lastHealthCheck: true,
        campaignHealthHistory: true,
        currentTurnNumber: true,
      },
    })

    // No check has run yet (a campaign under 5 scenes). That's a real,
    // expected state rather than an error — the UI shows "not yet
    // assessed" instead of a misleading zero.
    if (!worldMeta || worldMeta.currentHealthScore === null) {
      return NextResponse.json({
        assessed: false,
        score: null,
        lastCheckedAt: null,
        currentTurnNumber: worldMeta?.currentTurnNumber ?? null,
        issues: [],
        recommendations: [],
        // Never assessed is not a crisis. Reported explicitly so the client
        // has no reason to infer a verdict from a missing score.
        needsIntervention: false,
        band: 'fair',
      })
    }

    // campaignHealthHistory is an append-only array of past checks; the
    // newest entry carries the issues/recommendations behind the score.
    const history = Array.isArray(worldMeta.campaignHealthHistory)
      ? (worldMeta.campaignHealthHistory as any[])
      : []
    const latest = history.length > 0 ? history[history.length - 1] : null

    const issues = Array.isArray(latest?.issues) ? latest.issues : []
    // The verdict is computed server-side from the SAME rule the scene
    // resolver uses, rather than left for the client to re-derive from a
    // score. A panel inventing its own thresholds is how the admin page
    // came to show an amber badge on a campaign the engine considered to
    // be in trouble.
    const summary = { score: worldMeta.currentHealthScore, issues }

    return NextResponse.json({
      assessed: true,
      score: worldMeta.currentHealthScore,
      lastCheckedAt: worldMeta.lastHealthCheck,
      currentTurnNumber: worldMeta.currentTurnNumber,
      issues,
      recommendations: Array.isArray(latest?.recommendations) ? latest.recommendations : [],
      needsIntervention: needsIntervention(summary),
      band: healthBand(summary),
    })
  } catch (error) {
    console.error('Get campaign health error:', error)
    return NextResponse.json({ error: 'Failed to get campaign health' }, { status: 500 })
  }
}
