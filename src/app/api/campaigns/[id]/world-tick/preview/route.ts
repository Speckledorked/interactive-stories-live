// src/app/api/campaigns/[id]/world-tick/preview/route.ts
// World Sim Phase 8 — simulation debug tooling: dry-run the next world tick.
// Runs every tick handler against live DB state and returns the resulting
// WorldChange list, but every write is skipped (see TickContext.dryRun) —
// nothing is persisted, the turn number doesn't advance, and none of the
// normal post-tick side effects (history log, wiki sync, event log) run.
// Admin-only, same reasoning as world-events: reasons can reference GM-only
// state.
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { runWorldTick } from '@/lib/game/worldTick'

export async function POST(
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

    if (!membership || membership.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Only campaign admins can preview the world tick' },
        { status: 403 }
      )
    }

    const worldMeta = await prisma.worldMeta.findUnique({
      where: { campaignId },
      select: { currentTurnNumber: true },
    })

    if (!worldMeta) {
      return NextResponse.json({ error: 'Campaign has no world state yet' }, { status: 404 })
    }

    const result = await runWorldTick(campaignId, worldMeta.currentTurnNumber, { dryRun: true })

    return NextResponse.json({ turnNumber: result.turnNumber, changes: result.changes })
  } catch (error) {
    console.error('Preview world tick error:', error)
    return NextResponse.json({ error: 'Failed to preview world tick' }, { status: 500 })
  }
}
