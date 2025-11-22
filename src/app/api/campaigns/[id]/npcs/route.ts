// src/app/api/campaigns/[id]/npcs/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'

// GET /api/campaigns/:id/npcs - List all NPCs for a campaign
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

    // Check if user is a member
    const membership = await prisma.campaignMembership.findUnique({
      where: {
        userId_campaignId: {
          userId: user.userId,
          campaignId,
        },
      },
    })

    if (!membership) {
      return NextResponse.json(
        { error: 'Not a member of this campaign' },
        { status: 403 }
      )
    }

    // Get all NPCs for the campaign
    const npcs = await prisma.nPC.findMany({
      where: { campaignId },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ npcs })
  } catch (error) {
    console.error('Get NPCs error:', error)
    return NextResponse.json(
      { error: 'Failed to get NPCs' },
      { status: 500 }
    )
  }
}

// POST /api/campaigns/:id/npcs - Create a new NPC
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
        { error: 'Only campaign admins can create NPCs' },
        { status: 403 }
      )
    }

    // Validate required fields
    if (!body.name) {
      return NextResponse.json(
        { error: 'NPC name is required' },
        { status: 400 }
      )
    }

    // Create NPC
    const npc = await prisma.nPC.create({
      data: {
        campaignId,
        name: body.name,
        pronouns: body.pronouns || null,
        description: body.description || null,
        currentLocation: body.currentLocation || null,
        goals: body.goals || null,
        relationship: body.relationship || null,
        isAlive: body.isAlive !== undefined ? body.isAlive : true,
        importance: body.importance || 1,
        gmNotes: body.gmNotes || null,
        threat: body.threat || null,
        impulses: body.impulses || [],
        moves: body.moves || [],
      },
    })

    return NextResponse.json({ npc }, { status: 201 })
  } catch (error) {
    console.error('Create NPC error:', error)
    return NextResponse.json(
      { error: 'Failed to create NPC' },
      { status: 500 }
    )
  }
}
