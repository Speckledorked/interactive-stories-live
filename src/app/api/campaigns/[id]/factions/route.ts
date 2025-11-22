// src/app/api/campaigns/[id]/factions/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'

// GET /api/campaigns/:id/factions - List all factions for a campaign
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

    // Get all factions for the campaign
    const factions = await prisma.faction.findMany({
      where: { campaignId },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ factions })
  } catch (error) {
    console.error('Get factions error:', error)
    return NextResponse.json(
      { error: 'Failed to get factions' },
      { status: 500 }
    )
  }
}

// POST /api/campaigns/:id/factions - Create a new faction
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
        { error: 'Only campaign admins can create factions' },
        { status: 403 }
      )
    }

    // Validate required fields
    if (!body.name) {
      return NextResponse.json(
        { error: 'Faction name is required' },
        { status: 400 }
      )
    }

    // Create faction
    const faction = await prisma.faction.create({
      data: {
        campaignId,
        name: body.name,
        description: body.description || null,
        goals: body.goals || null,
        resources: body.resources !== undefined ? body.resources : 50,
        influence: body.influence !== undefined ? body.influence : 50,
        currentPlan: body.currentPlan || null,
        threatLevel: body.threatLevel || 1,
        relationships: body.relationships || null,
        gmNotes: body.gmNotes || null,
      },
    })

    return NextResponse.json({ faction }, { status: 201 })
  } catch (error) {
    console.error('Create faction error:', error)
    return NextResponse.json(
      { error: 'Failed to create faction' },
      { status: 500 }
    )
  }
}
