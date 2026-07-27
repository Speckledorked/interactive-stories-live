// src/app/api/campaigns/[id]/locations/[locationId]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { requireCampaignAdmin } from '@/lib/db/campaignAccess'

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
    const adminCheck = await requireCampaignAdmin(user.userId, campaignId, 'Only campaign admins can update locations')
    if ('response' in adminCheck) return adminCheck.response

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
    const adminCheck = await requireCampaignAdmin(user.userId, campaignId, 'Only campaign admins can delete locations')
    if ('response' in adminCheck) return adminCheck.response

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
