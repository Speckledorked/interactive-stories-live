// src/app/api/campaigns/[id]/logs/day/route.ts
// The Story Log calendar's click-through: everything that happened on one
// specific in-game day (an absolute day number since campaign epoch — see
// lib/game/calendar.ts), Story Log entries and Rumors together. Never
// returns summaryGM — same redaction discipline as rumors/route.ts, whose
// select this mirrors exactly for the rumors half.
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { getCampaignMembership } from '@/lib/db/campaignAccess'
import { handleRouteError } from '@/lib/api/errors'

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

    const { searchParams } = new URL(request.url)
    const dayNumber = parseInt(searchParams.get('dayNumber') || '', 10)
    if (!Number.isInteger(dayNumber)) {
      return NextResponse.json({ error: 'Invalid dayNumber' }, { status: 400 })
    }

    const [logs, rumorEvents] = await Promise.all([
      prisma.campaignLog.findMany({
        where: { campaignId, inGameDayNumber: dayNumber },
        orderBy: { turnNumber: 'asc' },
      }),
      prisma.timelineEvent.findMany({
        where: {
          campaignId,
          inGameDayNumber: dayNumber,
          isOffscreen: true,
          visibility: { in: ['PUBLIC', 'MIXED'] },
          summaryPublic: { not: null },
        },
        orderBy: { turnNumber: 'asc' },
        select: { id: true, turnNumber: true, title: true, summaryPublic: true },
      }),
    ])

    const rumors = rumorEvents.map((e) => ({
      id: e.id,
      turnNumber: e.turnNumber,
      title: e.title,
      summary: e.summaryPublic,
    }))

    return NextResponse.json({ logs, rumors })
  } catch (error) {
    return handleRouteError(error, 'Get logs by day error', 'Failed to get day entries')
  }
}
