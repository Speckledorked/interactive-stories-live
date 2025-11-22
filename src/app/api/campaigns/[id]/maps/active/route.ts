import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { MapService } from '@/lib/maps/map-service'

// GET /api/campaigns/[id]/maps/active - Get the currently active map
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const token = request.headers.get('authorization')?.split(' ')[1]
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const user = verifyToken(token)
    if (!user) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    const campaignId = params.id

    // Verify user is a member of the campaign
    const membership = await prisma.campaignMembership.findFirst({
      where: {
        campaignId,
        userId: user.userId
      }
    })

    if (!membership) {
      return NextResponse.json({ error: 'Not a member of this campaign' }, { status: 403 })
    }

    const activeMap = await MapService.getActiveMap(campaignId)

    if (!activeMap) {
      return NextResponse.json({ map: null })
    }

    return NextResponse.json({ map: activeMap })
  } catch (error) {
    console.error('Error fetching active map:', error)
    return NextResponse.json({ error: 'Failed to fetch active map' }, { status: 500 })
  }
}

// PUT /api/campaigns/[id]/maps/active - Set the active map
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const token = request.headers.get('authorization')?.split(' ')[1]
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const user = verifyToken(token)
    if (!user) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    const campaignId = params.id

    // Verify user is admin of the campaign
    const membership = await prisma.campaignMembership.findFirst({
      where: {
        campaignId,
        userId: user.userId,
        role: 'ADMIN'
      }
    })

    if (!membership) {
      return NextResponse.json({ error: 'Only campaign admins can set the active map' }, { status: 403 })
    }

    const body = await request.json()
    const { mapId } = body

    if (!mapId) {
      return NextResponse.json({ error: 'mapId is required' }, { status: 400 })
    }

    // Verify map belongs to campaign
    const map = await MapService.getMapById(mapId)
    if (!map || map.campaignId !== campaignId) {
      return NextResponse.json({ error: 'Map not found' }, { status: 404 })
    }

    await MapService.setActiveMap(campaignId, mapId)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error setting active map:', error)
    return NextResponse.json({ error: 'Failed to set active map' }, { status: 500 })
  }
}
