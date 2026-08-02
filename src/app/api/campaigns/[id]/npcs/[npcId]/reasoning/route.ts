// src/app/api/campaigns/[id]/npcs/[npcId]/reasoning/route.ts
// #94 — "show your reasoning" for the NPC admin tab, the same pattern the
// tick dry-run preview already established for the whole simulation
// (world-tick/preview/route.ts), scoped to one NPC. Read-only: loads the
// exact same inputs tickNpcs (npcTick.ts) reads for real, then calls the
// same pure decideNpcTick a real tick would — nothing here writes anything
// or advances the turn.
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { requireCampaignAdmin } from '@/lib/db/campaignAccess'
import { decideNpcTick } from '@/lib/game/tick/npcTick'
import type { AdjacencyEdge } from '@/lib/game/worldGraph'
import { visibleTo } from '@/lib/api/visibility'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string; npcId: string } }
) {
  try {
    const user = await getUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: campaignId, npcId } = params

    const adminCheck = await requireCampaignAdmin(user.userId, campaignId, 'Only campaign admins can preview NPC reasoning')
    if ('response' in adminCheck) return adminCheck.response

    const [npc, worldMeta, locations, adjacencyRows] = await Promise.all([
      prisma.nPC.findFirst({
        where: { id: npcId, campaignId },
        select: {
          id: true, name: true, goals: true, relationship: true, currentLocation: true, goalProgress: true,
          faction: { select: { name: true, goal: true, isActive: true } },
        },
      }),
      prisma.worldMeta.findUnique({ where: { campaignId }, select: { currentTurnNumber: true } }),
      // decideNpcTick's real caller (tickNpcs) always restricts candidate
      // locations to discovered ones, unconditionally — this isn't a
      // viewer-visibility gate (the route is already admin-only), it's the
      // same fog-of-war filter the simulation itself always applies, so the
      // preview matches what the real tick would actually do. Routed
      // through the shared helper (with a fixed non-admin role) rather than
      // a hand-rolled `isDiscovered: true`, per this app's one column/
      // polarity source of truth (src/lib/api/visibility.ts).
      prisma.location.findMany({ where: { campaignId, ...visibleTo('location', 'PLAYER') }, select: { id: true, name: true } }),
      prisma.locationAdjacency.findMany({ where: { campaignId }, select: { locationAId: true, locationBId: true, distance: true } }),
    ])

    if (!npc) {
      return NextResponse.json({ error: 'NPC not found' }, { status: 404 })
    }
    if (!worldMeta) {
      return NextResponse.json({ error: 'Campaign has no world state yet' }, { status: 404 })
    }

    const discoveredLocationNames = locations.map((l) => l.name)
    const locationIdByName = new Map(locations.map((l) => [l.name, l.id]))
    const locationGraph = { idByName: locationIdByName, edges: adjacencyRows as AdjacencyEdge[] }
    const factionContext = npc.faction?.isActive ? { name: npc.faction.name, goal: npc.faction.goal } : null

    const decision = decideNpcTick(npc, worldMeta.currentTurnNumber, discoveredLocationNames, factionContext, locationGraph)

    return NextResponse.json({
      npc: { id: npc.id, name: npc.name },
      turnNumber: worldMeta.currentTurnNumber,
      decision,
    })
  } catch (error) {
    console.error('NPC reasoning preview error:', error)
    return NextResponse.json({ error: 'Failed to preview NPC reasoning' }, { status: 500 })
  }
}
