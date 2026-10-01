// src/app/api/public/chronicle/[token]/route.ts
// Unauthenticated, read-only story log for a campaign's public chronicle
// link (see chronicle-share/route.ts for the GM toggle that mints this
// token). Deliberately minimal surface: only resolved scenes' narrative
// text, never GM notes, never in-progress scenes, never character sheets,
// stats, or admin/simulation data of any kind.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(
  request: NextRequest,
  { params }: { params: { token: string } }
) {
  try {
    const campaign = await prisma.campaign.findUnique({
      where: { chronicleShareToken: params.token },
      select: {
        id: true,
        title: true,
        description: true,
        universe: true,
        chronicleShareEnabled: true,
      },
    })

    if (!campaign || !campaign.chronicleShareEnabled) {
      return NextResponse.json({ error: 'This chronicle link is not available' }, { status: 404 })
    }

    // #490: if this campaign's world has been published, the chronicle can
    // offer its reader a way in. The issue's point exactly — these links
    // were well-built and ended in a full stop, so a reader who had just
    // been sold on a world had nowhere to go with that.
    //
    // Only a LISTED world: unlisting is the author saying they would rather
    // not be a starting point, and a CTA that ignored that would make
    // unlisting meaningless for the surface that drives the most traffic.
    const publishedWorld = await prisma.publishedWorld.findFirst({
      where: { sourceCampaignId: campaign.id, isListed: true },
      select: { slug: true },
    })

    const scenes = await prisma.scene.findMany({
      where: { campaignId: campaign.id, status: 'RESOLVED' },
      select: {
        sceneNumber: true,
        sceneIntroText: true,
        sceneResolutionText: true,
      },
      orderBy: { sceneNumber: 'asc' },
    })

    return NextResponse.json({
      campaign: {
        title: campaign.title,
        description: campaign.description,
        universe: campaign.universe,
      },
      // The slug only. The world's own public page carries everything else,
      // and duplicating it here would be a second thing to keep in step.
      worldSlug: publishedWorld?.slug ?? null,
      // `title` is deliberately absent: Scene.title was a column nothing ever
      // wrote (dropped 20260820140000), so every chronicle entry shipped
      // title: null and readers rendered their own fallback anyway.
      scenes: scenes.map(s => ({
        sceneNumber: s.sceneNumber,
        introText: s.sceneIntroText,
        resolutionText: s.sceneResolutionText,
      })),
    })
  } catch (error) {
    console.error('Get public chronicle error:', error)
    return NextResponse.json({ error: 'Failed to load chronicle' }, { status: 500 })
  }
}
