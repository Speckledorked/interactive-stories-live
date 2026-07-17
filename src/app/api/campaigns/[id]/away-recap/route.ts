// src/app/api/campaigns/[id]/away-recap/route.ts
// "While you were away" — a dedicated checkpoint separate from the main
// campaign GET (which the story page polls constantly via Pusher-triggered
// reloads and would otherwise reset lastViewedAt every few seconds). Only
// the lobby page should call this: it's the actual "I came back and looked"
// signal.
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { buildAwayRecap } from '@/lib/game/awayRecap'

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

    const previousLastViewedAt = membership.lastViewedAt
    const now = new Date()

    const events = previousLastViewedAt
      ? await prisma.timelineEvent.findMany({
          where: {
            campaignId,
            isOffscreen: true,
            visibility: { in: ['PUBLIC', 'MIXED'] },
            createdAt: { gt: previousLastViewedAt },
          },
          orderBy: { turnNumber: 'desc' },
          take: 20,
          select: { id: true, title: true, summaryPublic: true, turnNumber: true, createdAt: true },
        })
      : []

    const recap = buildAwayRecap(events, previousLastViewedAt, now)

    await prisma.campaignMembership.update({
      where: { id: membership.id },
      data: { lastViewedAt: now },
    })

    return NextResponse.json({ recap })
  } catch (error) {
    console.error('Get away-recap error:', error)
    return NextResponse.json({ error: 'Failed to get away recap' }, { status: 500 })
  }
}
