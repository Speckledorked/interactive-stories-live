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
import { requireCampaignAdmin } from '@/lib/db/campaignAccess'

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

    const adminCheck = await requireCampaignAdmin(user.userId, campaignId, 'Only campaign admins can preview the world tick')
    if ('response' in adminCheck) return adminCheck.response

    const worldMeta = await prisma.worldMeta.findUnique({
      where: { campaignId },
      select: { simulationTurn: true },
    })

    if (!worldMeta) {
      return NextResponse.json({ error: 'Campaign has no world state yet' }, { status: 404 })
    }

    // #374: preview the turn that would ACTUALLY run next — simulationTurn
    // + 1, exactly what runWorldTurn will pass. This used to preview at
    // currentTurnNumber (the scene counter), which is a different clock
    // entirely, so the preview's window arithmetic (information age, war
    // duration, goal commitment) described a turn that would never happen.
    const result = await runWorldTick(campaignId, worldMeta.simulationTurn + 1, { dryRun: true })

    return NextResponse.json({ turnNumber: result.turnNumber, changes: result.changes })
  } catch (error) {
    console.error('Preview world tick error:', error)
    return NextResponse.json({ error: 'Failed to preview world tick' }, { status: 500 })
  }
}
