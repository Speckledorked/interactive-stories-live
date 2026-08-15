// src/app/api/campaigns/[id]/npcs/[npcId]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { resolveOrCreateLocationId } from '@/lib/game/worldUpdaters/locations'
import { requireCampaignAdmin } from '@/lib/db/campaignAccess'
import { guardNpcLeaderAssignment } from '@/lib/game/leadershipGuard'

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; npcId: string } }
) {
  try {
    const user = await getUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: campaignId, npcId } = params
    const body = await request.json()

    // Check if user is admin
    const adminCheck = await requireCampaignAdmin(user.userId, campaignId, 'Only campaign admins can update NPCs')
    if ('response' in adminCheck) return adminCheck.response

    // Resolve/create the matching Location row and link it via locationId
    // alongside the free-text field (see README Known Bugs P1 — Location
    // stored as free text, not an FK) — only when currentLocation is
    // actually part of this PATCH; `undefined` here means "leave as is",
    // matching every other field's semantics in this same update. A blank
    // currentLocation resolves to null, clearing the FK along with the
    // text field.
    const locationId = body.currentLocation !== undefined
      ? await resolveOrCreateLocationId(prisma, campaignId, body.currentLocation, body.isDiscovered !== false)
      : undefined

    // #275: "at most one leader either way" — reject/auto-demote a
    // conflicting claim before it's ever written, rather than leaving the
    // faction with two simultaneous leaders for the integrity engine to
    // find later. excludeNpcId is this NPC itself — being (re)confirmed as
    // LEADER isn't a conflict with its own prior role.
    const factionRole = body.factionId ? (body.factionRole || 'MEMBER') : null
    if (factionRole === 'LEADER') {
      const guard = await guardNpcLeaderAssignment(campaignId, body.factionId, npcId)
      if (!guard.ok) {
        return NextResponse.json({ error: guard.error }, { status: 400 })
      }
    }

    // Update NPC
    const npc = await prisma.nPC.update({
      where: {
        id: npcId,
        campaignId, // Ensure NPC belongs to this campaign
      },
      data: {
        name: body.name,
        description: body.description,
        currentLocation: body.currentLocation,
        locationId,
        goals: body.goals,
        relationship: body.relationship,
        isAlive: body.isAlive,
        importance: body.importance,
        gmNotes: body.gmNotes,
        factionId: body.factionId || null,
        factionRole,
        isDiscovered: body.isDiscovered,
      },
    })

    return NextResponse.json({ npc })
  } catch (error) {
    console.error('Update NPC error:', error)
    return NextResponse.json(
      { error: 'Failed to update NPC' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; npcId: string } }
) {
  try {
    const user = await getUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: campaignId, npcId } = params

    // Check if user is admin
    const adminCheck = await requireCampaignAdmin(user.userId, campaignId, 'Only campaign admins can delete NPCs')
    if ('response' in adminCheck) return adminCheck.response

    // Delete NPC
    await prisma.nPC.delete({
      where: { 
        id: npcId,
        campaignId,
      },
    })

    return NextResponse.json({ message: 'NPC deleted successfully' })
  } catch (error) {
    console.error('Delete NPC error:', error)
    return NextResponse.json(
      { error: 'Failed to delete NPC' },
      { status: 500 }
    )
  }
}
