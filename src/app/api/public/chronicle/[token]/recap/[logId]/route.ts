// src/app/api/public/chronicle/[token]/recap/[logId]/route.ts
// Unauthenticated, read-only data for a single shareable session recap —
// a resolved scene or short arc packaged as a social-media-sized card.
// Builds on the existing chronicle share link (chronicle-share/route.ts
// mints the token; ../route.ts is this same pattern for the full
// chronicle) rather than a separate share mechanism: a recap can only be
// generated for a campaign that has already opted into public sharing.
// Reuses CampaignLog — the same title/summary/highlights already shown on
// the Story Log page — instead of re-deriving a summary from scene text.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkRateLimit, getClientIp, RECAP_VIEW_LIMIT } from '@/lib/rateLimit'

export async function GET(
  request: NextRequest,
  { params }: { params: { token: string; logId: string } }
) {
  try {
    const campaign = await prisma.campaign.findUnique({
      where: { chronicleShareToken: params.token },
      select: {
        id: true,
        title: true,
        universe: true,
        heroImageUrl: true,
        chronicleShareEnabled: true,
      },
    })

    if (!campaign || !campaign.chronicleShareEnabled) {
      return NextResponse.json({ error: 'This chronicle link is not available' }, { status: 404 })
    }

    const log = await prisma.campaignLog.findUnique({
      where: { id: params.logId },
      select: {
        id: true,
        campaignId: true,
        title: true,
        summary: true,
        highlights: true,
        entryType: true,
        inGameDate: true,
        turnNumber: true,
      },
    })

    // Scoped to THIS campaign's token — a valid logId from a different
    // campaign must not resolve here just because both are publicly shared.
    if (!log || log.campaignId !== campaign.id) {
      return NextResponse.json({ error: 'This recap is not available' }, { status: 404 })
    }

    // #264: smallest real signal of whether shareable recaps are used at
    // all — counts an actual page load, not a share-link copy/generation.
    // Awaited (not fire-and-forget) since serverless functions can be
    // frozen the instant the response is sent.
    //
    // #324: unconditionally incrementing here let a trivial scripted loop
    // inflate the count arbitrarily. Deduped per IP+recap rather than
    // rejected outright — this is a public, unauthenticated read route and
    // the view itself must still succeed either way, only the counter is
    // gated.
    const viewLimit = await checkRateLimit(
      `${getClientIp(request)}:${log.id}`,
      RECAP_VIEW_LIMIT.bucket,
      RECAP_VIEW_LIMIT.limit,
      RECAP_VIEW_LIMIT.windowSeconds
    )
    if (viewLimit.allowed) {
      await prisma.campaignLog.update({
        where: { id: log.id },
        data: { recapViewCount: { increment: 1 } },
      })
    }

    return NextResponse.json({
      campaign: {
        title: campaign.title,
        universe: campaign.universe,
        heroImageUrl: campaign.heroImageUrl,
      },
      recap: {
        title: log.title,
        summary: log.summary,
        highlights: log.highlights,
        entryType: log.entryType,
        inGameDate: log.inGameDate,
        turnNumber: log.turnNumber,
      },
    })
  } catch (error) {
    console.error('Get public recap error:', error)
    return NextResponse.json({ error: 'Failed to load recap' }, { status: 500 })
  }
}
