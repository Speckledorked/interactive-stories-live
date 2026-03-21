// src/app/api/campaigns/[id]/stats/route.ts
// GET /api/campaigns/:id/stats
// Returns the CampaignStats shape expected by PlayerDashboard

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = requireAuth(request)
    const campaignId = params.id

    const membership = await prisma.campaignMembership.findUnique({
      where: { userId_campaignId: { userId: user.userId, campaignId } }
    })

    if (!membership) {
      return NextResponse.json({ error: 'Not a member of this campaign' }, { status: 403 })
    }

    const [totalScenes, activePlayers, lastScene, nextSession] = await Promise.all([
      prisma.scene.count({ where: { campaignId } }),
      prisma.campaignMembership.count({ where: { campaignId } }),
      prisma.scene.findFirst({
        where: { campaignId },
        orderBy: { sceneNumber: 'desc' },
        select: { sceneNumber: true, updatedAt: true }
      }),
      prisma.session.findFirst({
        where: {
          campaignId,
          scheduledDate: { gt: new Date() }
        },
        orderBy: { scheduledDate: 'asc' },
        select: { scheduledDate: true }
      })
    ])

    return NextResponse.json({
      totalScenes,
      activePlayers,
      currentTurn: lastScene?.sceneNumber ?? 0,
      lastSessionDate: lastScene?.updatedAt ?? null,
      nextSessionDate: nextSession?.scheduledDate ?? null
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('Campaign stats error:', error)
    return NextResponse.json({ error: 'Failed to fetch campaign stats' }, { status: 500 })
  }
}
