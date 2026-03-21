// src/app/api/campaigns/[id]/timeline/route.ts
// GET /api/campaigns/:id/timeline

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

    const isAdmin = membership.role === 'ADMIN'

    const events = await prisma.timelineEvent.findMany({
      where: {
        campaignId,
        ...(isAdmin ? {} : { visibility: { not: 'GM_ONLY' } })
      },
      orderBy: [{ turnNumber: 'asc' }, { createdAt: 'asc' }]
    })

    return NextResponse.json(events)
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('Timeline fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch timeline' }, { status: 500 })
  }
}
