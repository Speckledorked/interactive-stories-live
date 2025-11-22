import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { MapService } from '@/lib/maps/map-service'

// GET /api/campaigns/[id]/maps/[mapId] - Get a specific map
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string; mapId: string } }
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
    const mapId = params.mapId

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

    const map = await MapService.getMapById(mapId)

    if (!map || map.campaignId !== campaignId) {
      return NextResponse.json({ error: 'Map not found' }, { status: 404 })
    }

    return NextResponse.json({ map })
  } catch (error) {
    console.error('Error fetching map:', error)
    return NextResponse.json({ error: 'Failed to fetch map' }, { status: 500 })
  }
}

// PATCH /api/campaigns/[id]/maps/[mapId] - Update a map
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; mapId: string } }
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
    const mapId = params.mapId

    // Verify user is admin of the campaign
    const membership = await prisma.campaignMembership.findFirst({
      where: {
        campaignId,
        userId: user.userId,
        role: 'ADMIN'
      }
    })

    if (!membership) {
      return NextResponse.json({ error: 'Only campaign admins can update maps' }, { status: 403 })
    }

    // Verify map belongs to campaign
    const existingMap = await MapService.getMapById(mapId)
    if (!existingMap || existingMap.campaignId !== campaignId) {
      return NextResponse.json({ error: 'Map not found' }, { status: 404 })
    }

    const body = await request.json()
    const { name, description, width, height, gridSize, background, sceneId } = body

    const map = await MapService.updateMap(mapId, {
      name,
      description,
      width,
      height,
      gridSize,
      imageUrl: background,
      sessionId: sceneId
    })

    return NextResponse.json({ map })
  } catch (error) {
    console.error('Error updating map:', error)
    return NextResponse.json({ error: 'Failed to update map' }, { status: 500 })
  }
}

// DELETE /api/campaigns/[id]/maps/[mapId] - Delete a map
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; mapId: string } }
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
    const mapId = params.mapId

    // Verify user is admin of the campaign
    const membership = await prisma.campaignMembership.findFirst({
      where: {
        campaignId,
        userId: user.userId,
        role: 'ADMIN'
      }
    })

    if (!membership) {
      return NextResponse.json({ error: 'Only campaign admins can delete maps' }, { status: 403 })
    }

    // Verify map belongs to campaign
    const existingMap = await MapService.getMapById(mapId)
    if (!existingMap || existingMap.campaignId !== campaignId) {
      return NextResponse.json({ error: 'Map not found' }, { status: 404 })
    }

    await MapService.deleteMap(mapId)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting map:', error)
    return NextResponse.json({ error: 'Failed to delete map' }, { status: 500 })
  }
}
