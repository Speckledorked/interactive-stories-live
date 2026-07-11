// src/app/api/campaigns/[id]/world-events/route.ts
// World Sim Phase 8 — simulation debug tooling: browse the durable
// WorldEvent log (every deterministic tick change and player-action
// consequence, with the reason the simulation made that call). Admin-only —
// reason strings can reference GM-only state (a hidden faction's scheme,
// an undiscovered NPC's plan) the same way gmNotes can.
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
    const { searchParams } = new URL(request.url)
    const turnParam = searchParams.get('turn')

    const membership = await prisma.campaignMembership.findUnique({
      where: { userId_campaignId: { userId: user.userId, campaignId } },
    })

    if (!membership || membership.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Only campaign admins can view the tick log' },
        { status: 403 }
      )
    }

    const where: any = { campaignId }
    if (turnParam !== null) {
      const turnNumber = parseInt(turnParam, 10)
      if (!Number.isInteger(turnNumber)) {
        return NextResponse.json({ error: 'turn must be an integer' }, { status: 400 })
      }
      where.turnNumber = turnNumber
    }

    const events = await prisma.worldEvent.findMany({
      where,
      orderBy: [{ turnNumber: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    })

    return NextResponse.json({ events })
  } catch (error) {
    console.error('Get world events error:', error)
    return NextResponse.json({ error: 'Failed to get world events' }, { status: 500 })
  }
}
