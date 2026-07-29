// src/app/api/campaigns/[id]/integrity/route.ts
//
// Read side for the Integrity Engine (game/integrity/, Phase 2). Mirrors
// campaigns/[id]/health/route.ts's shape and access pattern exactly — this
// exposes what tickIntegrity already computed and persisted every world
// turn (integrityReportHistory / lastIntegrityCheck on WorldMeta). It
// deliberately does NOT run a pass itself; hitting this endpoint costs a
// single indexed read.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { getCampaignMembership } from '@/lib/db/campaignAccess'
import type { IntegrityReport } from '@/lib/game/integrity/types'

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

    const membership = await getCampaignMembership(user.userId, campaignId)

    if (!membership) {
      return NextResponse.json({ error: 'Not a member of this campaign' }, { status: 403 })
    }

    const worldMeta = await prisma.worldMeta.findUnique({
      where: { campaignId },
      select: {
        integrityReportHistory: true,
        lastIntegrityCheck: true,
      },
    })

    // No world turn has run an integrity pass yet — real and expected for a
    // brand-new campaign, not an error.
    if (!worldMeta || !worldMeta.lastIntegrityCheck) {
      return NextResponse.json({
        assessed: false,
        lastCheckedAt: null,
        latest: null,
        history: [],
      })
    }

    const history = Array.isArray(worldMeta.integrityReportHistory)
      ? (worldMeta.integrityReportHistory as unknown as IntegrityReport[])
      : []
    const latest = history.length > 0 ? history[history.length - 1] : null

    return NextResponse.json({
      assessed: true,
      lastCheckedAt: worldMeta.lastIntegrityCheck,
      latest,
      // Oldest first, capped the same as the persisted bound — the panel
      // reads this for a trend, not just the latest snapshot.
      history,
    })
  } catch (error) {
    console.error('Get campaign integrity error:', error)
    return NextResponse.json({ error: 'Failed to get campaign integrity' }, { status: 500 })
  }
}
