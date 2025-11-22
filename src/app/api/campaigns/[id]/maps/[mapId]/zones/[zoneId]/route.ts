import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { MapService } from '@/lib/maps/map-service'

// DELETE /api/campaigns/[id]/maps/[mapId]/zones/[zoneId] - Delete a zone
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; mapId: string; zoneId: string } }
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
    const zoneId = params.zoneId

    // Verify user is admin of the campaign
    const membership = await prisma.campaignMembership.findFirst({
      where: {
        campaignId,
        userId: user.userId,
        role: 'ADMIN'
      }
    })

    if (!membership) {
      return NextResponse.json({ error: 'Only campaign admins can delete zones' }, { status: 403 })
    }

    // Verify map belongs to campaign
    const map = await MapService.getMapById(mapId)
    if (!map || map.campaignId !== campaignId) {
      return NextResponse.json({ error: 'Map not found' }, { status: 404 })
    }

    // Verify zone belongs to map
    const zone = await prisma.zone.findUnique({
      where: { id: zoneId }
    })

    if (!zone || zone.mapId !== mapId) {
      return NextResponse.json({ error: 'Zone not found' }, { status: 404 })
    }

    await MapService.deleteZone(zoneId)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting zone:', error)
    return NextResponse.json({ error: 'Failed to delete zone' }, { status: 500 })
  }
}
