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

    const scenes = await prisma.scene.findMany({
      where: { campaignId: campaign.id, status: 'RESOLVED' },
      select: {
        sceneNumber: true,
        title: true,
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
      scenes: scenes.map(s => ({
        sceneNumber: s.sceneNumber,
        title: s.title,
        introText: s.sceneIntroText,
        resolutionText: s.sceneResolutionText,
      })),
    })
  } catch (error) {
    console.error('Get public chronicle error:', error)
    return NextResponse.json({ error: 'Failed to load chronicle' }, { status: 500 })
  }
}
