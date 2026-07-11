// src/app/api/campaigns/[id]/rumors/route.ts
// World Sim Phase 7 (deferred item) — a dedicated feed of things the party
// could plausibly have heard about without witnessing directly: offscreen
// events (isOffscreen: true) with PUBLIC or MIXED visibility. Distinct from
// the story/log, which is what players actually witnessed in scenes — this
// is what's circulating in the world around them. Never returns summaryGM;
// that stays GM-only regardless of role, same as the rest of this route
// tree's gmNotes redaction.
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'

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

    const events = await prisma.timelineEvent.findMany({
      where: {
        campaignId,
        isOffscreen: true,
        visibility: { in: ['PUBLIC', 'MIXED'] },
        summaryPublic: { not: null },
      },
      orderBy: { turnNumber: 'desc' },
      take: 50,
      select: { id: true, turnNumber: true, title: true, summaryPublic: true },
    })

    const rumors = events.map((e) => ({
      id: e.id,
      turnNumber: e.turnNumber,
      title: e.title,
      summary: e.summaryPublic,
    }))

    return NextResponse.json({ rumors })
  } catch (error) {
    console.error('Get rumors error:', error)
    return NextResponse.json({ error: 'Failed to get rumors' }, { status: 500 })
  }
}
