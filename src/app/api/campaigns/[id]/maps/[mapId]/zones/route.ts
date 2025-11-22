import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { MapService } from '@/lib/maps/map-service'

// POST /api/campaigns/[id]/maps/[mapId]/zones - Create a zone
export async function POST(
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
      return NextResponse.json({ error: 'Only campaign admins can create zones' }, { status: 403 })
    }

    // Verify map belongs to campaign
    const map = await MapService.getMapById(mapId)
    if (!map || map.campaignId !== campaignId) {
      return NextResponse.json({ error: 'Map not found' }, { status: 404 })
    }

    const body = await request.json()
    const { name, description, x, y, width, height, color, isVisible, triggerType, triggerData } = body

    const zone = await MapService.createZone(mapId, {
      name,
      description,
      x,
      y,
      width,
      height,
      color,
      isVisible,
      triggerType,
      triggerData
    })

    return NextResponse.json({ zone }, { status: 201 })
  } catch (error) {
    console.error('Error creating zone:', error)
    return NextResponse.json({ error: 'Failed to create zone' }, { status: 500 })
  }
}
