// src/app/api/campaigns/[id]/locations/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { redactGmNotesList } from '@/lib/game/visibility'

// GET /api/campaigns/:id/locations - List all locations for a campaign
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

    const isAdmin = membership.role === 'ADMIN'

    // Get all locations for the campaign — admins see undiscovered ones too
    // (so they can manage them), others see only what the party has found.
    const locations = await prisma.location.findMany({
      where: isAdmin ? { campaignId } : { campaignId, isDiscovered: true },
      orderBy: { name: 'asc' },
    })

    return NextResponse.json({ locations: redactGmNotesList(locations, isAdmin) })
  } catch (error) {
    console.error('Get locations error:', error)
    return NextResponse.json(
      { error: 'Failed to get locations' },
      { status: 500 }
    )
  }
}

// POST /api/campaigns/:id/locations - Create a new location
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
        { error: 'Only campaign admins can create locations' },
        { status: 403 }
      )
    }

    // Validate required fields
    if (!body.name) {
      return NextResponse.json(
        { error: 'Location name is required' },
        { status: 400 }
      )
    }

    // Create location
    const location = await prisma.location.create({
      data: {
        campaignId,
        name: body.name,
        description: body.description || null,
        locationType: body.locationType || null,
        gmNotes: body.gmNotes || null,
        ownerFactionId: body.ownerFactionId || null,
        isDiscovered: body.isDiscovered !== undefined ? body.isDiscovered : true,
      },
    })

    return NextResponse.json({ location }, { status: 201 })
  } catch (error) {
    console.error('Create location error:', error)
    return NextResponse.json(
      { error: 'Failed to create location' },
      { status: 500 }
    )
  }
}
