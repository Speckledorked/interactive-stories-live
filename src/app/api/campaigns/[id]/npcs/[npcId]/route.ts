// src/app/api/campaigns/[id]/npcs/[npcId]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'

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
    const membership = await prisma.campaignMembership.findUnique({
      where: {
        userId_campaignId: {
          userId: user.userId,
          campaignId,
        },
      },
    })

    if (!membership || membership.role !== 'admin') {
      return NextResponse.json(
        { error: 'Only campaign admins can update NPCs' },
        { status: 403 }
      )
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
        goals: body.goals,
        relationship: body.relationship,
        isAlive: body.isAlive,
        importance: body.importance,
        gmNotes: body.gmNotes,
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
    const membership = await prisma.campaignMembership.findUnique({
      where: {
        userId_campaignId: {
          userId: user.userId,
          campaignId,
        },
      },
    })

    if (!membership || membership.role !== 'admin') {
      return NextResponse.json(
        { error: 'Only campaign admins can delete NPCs' },
        { status: 403 }
      )
    }

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
