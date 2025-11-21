// src/app/api/campaigns/[id]/factions/[factionId]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; factionId: string } }
) {
  try {
    const user = await getUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: campaignId, factionId } = params
    const body = await request.json()

    // Check if user is admin
    const membership = await prisma.campaignMembership.findUnique({
      where: {
        userId_campaignId: {
          userId: user.userId,
          campaignId,
        },
      },
    })

    if (!membership || membership.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Only campaign admins can update factions' },
        { status: 403 }
      )
    }

    // Update Faction
    const faction = await prisma.faction.update({
      where: { 
        id: factionId,
        campaignId,
      },
      data: {
        name: body.name,
        description: body.description,
        goals: body.goals,
        resources: body.resources,
        influence: body.influence,
        currentPlan: body.currentPlan,
        threatLevel: body.threatLevel,
        relationships: body.relationships,
        gmNotes: body.gmNotes,
      },
    })

    return NextResponse.json({ faction })
  } catch (error) {
    console.error('Update faction error:', error)
    return NextResponse.json(
      { error: 'Failed to update faction' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; factionId: string } }
) {
  try {
    const user = await getUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: campaignId, factionId } = params

    // Check if user is admin
    const membership = await prisma.campaignMembership.findUnique({
      where: {
        userId_campaignId: {
          userId: user.userId,
          campaignId,
        },
      },
    })

    if (!membership || membership.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Only campaign admins can delete factions' },
        { status: 403 }
      )
    }

    // Delete Faction
    await prisma.faction.delete({
      where: { 
        id: factionId,
        campaignId,
      },
    })

    return NextResponse.json({ message: 'Faction deleted successfully' })
  } catch (error) {
    console.error('Delete faction error:', error)
    return NextResponse.json(
      { error: 'Failed to delete faction' },
      { status: 500 }
    )
  }
}
