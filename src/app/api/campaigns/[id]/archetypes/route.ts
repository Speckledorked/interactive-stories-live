// src/app/api/campaigns/[id]/archetypes/route.ts
// Origin archetype cards for the character creation wizard — readable by
// any campaign member (players pick from these when making a character).

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

    const archetypes = await prisma.campaignArchetype.findMany({
      where: { campaignId },
      orderBy: { createdAt: 'asc' },
    })

    return NextResponse.json({ archetypes })
  } catch (error) {
    console.error('Get archetypes error:', error)
    return NextResponse.json({ error: 'Failed to get archetypes' }, { status: 500 })
  }
}
