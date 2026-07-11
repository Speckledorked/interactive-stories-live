// src/app/api/campaigns/[id]/locations/[locationId]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; locationId: string } }
) {
  try {
    const user = await getUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: campaignId, locationId } = params
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
        { error: 'Only campaign admins can update locations' },
        { status: 403 }
      )
    }

    // Update location
    const location = await prisma.location.update({
      where: {
        id: locationId,
        campaignId, // Ensure location belongs to this campaign
      },
      data: {
        name: body.name,
        description: body.description,
        locationType: body.locationType,
        gmNotes: body.gmNotes,
        ownerFactionId: body.ownerFactionId || null,
        isDiscovered: body.isDiscovered,
      },
    })

    return NextResponse.json({ location })
  } catch (error) {
    console.error('Update location error:', error)
    return NextResponse.json(
      { error: 'Failed to update location' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; locationId: string } }
) {
  try {
    const user = await getUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: campaignId, locationId } = params

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
        { error: 'Only campaign admins can delete locations' },
        { status: 403 }
      )
    }

    // Delete location
    await prisma.location.delete({
      where: {
        id: locationId,
        campaignId,
      },
    })

    return NextResponse.json({ message: 'Location deleted successfully' })
  } catch (error) {
    console.error('Delete location error:', error)
    return NextResponse.json(
      { error: 'Failed to delete location' },
      { status: 500 }
    )
  }
}
