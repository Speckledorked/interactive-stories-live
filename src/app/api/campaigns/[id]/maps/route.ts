import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { MapService } from '@/lib/maps/map-service'

// GET /api/campaigns/[id]/maps - List all maps for a campaign
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

    const maps = await MapService.getMaps(campaignId)

    return NextResponse.json({ maps })
  } catch (error) {
    console.error('Error fetching maps:', error)
    return NextResponse.json({ error: 'Failed to fetch maps' }, { status: 500 })
  }
}

// POST /api/campaigns/[id]/maps - Create a new map
export async function POST(
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

    // Verify user is admin of the campaign (only admins can create maps)
    const membership = await prisma.campaignMembership.findFirst({
      where: {
        campaignId,
        userId: user.userId,
        role: 'ADMIN'
      }
    })

    if (!membership) {
      return NextResponse.json({ error: 'Only campaign admins can create maps' }, { status: 403 })
    }

    const body = await request.json()
    const { name, description, width, height, gridSize, background, sceneId } = body

    const map = await MapService.createMap(campaignId, {
      name,
      description,
      width,
      height,
      gridSize,
      imageUrl: background,
      sessionId: sceneId
    })

    return NextResponse.json({ map }, { status: 201 })
  } catch (error) {
    console.error('Error creating map:', error)
    return NextResponse.json({ error: 'Failed to create map' }, { status: 500 })
  }
}
