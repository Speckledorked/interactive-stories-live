// src/app/api/campaigns/[id]/settings/simulation/route.ts
// World Sim Phase 8 — per-campaign tick caps (see src/lib/game/tick/caps.ts).
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { DEFAULT_FACTION_CAP, DEFAULT_NPC_CAP } from '@/lib/game/tick/caps'

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

    const worldMeta = await prisma.worldMeta.findUnique({
      where: { campaignId },
      select: { factionCap: true, npcCap: true },
    })

    return NextResponse.json({
      factionCap: worldMeta?.factionCap ?? null,
      npcCap: worldMeta?.npcCap ?? null,
      defaultFactionCap: DEFAULT_FACTION_CAP,
      defaultNpcCap: DEFAULT_NPC_CAP,
    })
  } catch (error) {
    console.error('Get simulation settings error:', error)
    return NextResponse.json({ error: 'Failed to get simulation settings' }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const campaignId = params.id
    const body = await request.json()

    const membership = await prisma.campaignMembership.findUnique({
      where: { userId_campaignId: { userId: user.userId, campaignId } },
    })

    if (!membership || membership.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Only campaign admins can update simulation settings' },
        { status: 403 }
      )
    }

    // Null clears the override back to the default; a positive integer sets
    // a campaign-specific cap. Anything else is rejected rather than
    // silently coerced — a bad cap value would quietly change tick behavior.
    for (const field of ['factionCap', 'npcCap'] as const) {
      if (body[field] !== null && body[field] !== undefined) {
        if (!Number.isInteger(body[field]) || body[field] < 1) {
          return NextResponse.json(
            { error: `${field} must be a positive integer or null` },
            { status: 400 }
          )
        }
      }
    }

    const worldMeta = await prisma.worldMeta.update({
      where: { campaignId },
      data: {
        factionCap: body.factionCap === undefined ? undefined : body.factionCap,
        npcCap: body.npcCap === undefined ? undefined : body.npcCap,
      },
      select: { factionCap: true, npcCap: true },
    })

    return NextResponse.json({
      factionCap: worldMeta.factionCap,
      npcCap: worldMeta.npcCap,
      defaultFactionCap: DEFAULT_FACTION_CAP,
      defaultNpcCap: DEFAULT_NPC_CAP,
    })
  } catch (error) {
    console.error('Update simulation settings error:', error)
    return NextResponse.json({ error: 'Failed to update simulation settings' }, { status: 500 })
  }
}
