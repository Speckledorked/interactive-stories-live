import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { MapService } from '@/lib/maps/map-service'

// PATCH /api/campaigns/[id]/maps/[mapId]/tokens/[tokenId] - Move/update a token
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; mapId: string; tokenId: string } }
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
    const tokenId = params.tokenId

    // Verify user is a member of the campaign (any member can move tokens)
    const membership = await prisma.campaignMembership.findFirst({
      where: {
        campaignId,
        userId: user.userId
      }
    })

    if (!membership) {
      return NextResponse.json({ error: 'Not a member of this campaign' }, { status: 403 })
    }

    // Verify map belongs to campaign
    const map = await MapService.getMapById(mapId)
    if (!map || map.campaignId !== campaignId) {
      return NextResponse.json({ error: 'Map not found' }, { status: 404 })
    }

    // Verify token belongs to map
    const existingToken = await prisma.token.findUnique({
      where: { id: tokenId }
    })

    if (!existingToken || existingToken.mapId !== mapId) {
      return NextResponse.json({ error: 'Token not found' }, { status: 404 })
    }

    const body = await request.json()
    const { x, y } = body

    if (typeof x !== 'number' || typeof y !== 'number') {
      return NextResponse.json({ error: 'Invalid coordinates' }, { status: 400 })
    }

    await MapService.moveToken(tokenId, x, y)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error moving token:', error)
    return NextResponse.json({ error: 'Failed to move token' }, { status: 500 })
  }
}

// DELETE /api/campaigns/[id]/maps/[mapId]/tokens/[tokenId] - Delete a token
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; mapId: string; tokenId: string } }
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
    const tokenId = params.tokenId

    // Verify user is admin of the campaign
    const membership = await prisma.campaignMembership.findFirst({
      where: {
        campaignId,
        userId: user.userId,
        role: 'ADMIN'
      }
    })

    if (!membership) {
      return NextResponse.json({ error: 'Only campaign admins can delete tokens' }, { status: 403 })
    }

    // Verify map belongs to campaign
    const map = await MapService.getMapById(mapId)
    if (!map || map.campaignId !== campaignId) {
      return NextResponse.json({ error: 'Map not found' }, { status: 404 })
    }

    // Verify token belongs to map
    const existingToken = await prisma.token.findUnique({
      where: { id: tokenId }
    })

    if (!existingToken || existingToken.mapId !== mapId) {
      return NextResponse.json({ error: 'Token not found' }, { status: 404 })
    }

    await MapService.deleteToken(tokenId)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting token:', error)
    return NextResponse.json({ error: 'Failed to delete token' }, { status: 500 })
  }
}
