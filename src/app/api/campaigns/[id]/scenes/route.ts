import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'

// GET /api/campaigns/[id]/scenes - Get all scenes for a campaign
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = requireAuth(request)
    const campaignId = params.id

    // Verify user is a member of the campaign
    const membership = await prisma.campaignMembership.findFirst({
      where: {
        campaignId,
        userId: user.userId
      }
    })

    if (!membership) {
      return NextResponse.json(
        { error: 'Not a member of this campaign' },
        { status: 403 }
      )
    }

    // Get all scenes for the campaign with player actions and user info
    const scenes = await prisma.scene.findMany({
      where: { campaignId },
      include: {
        playerActions: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                name: true
              }
            }
          }
        }
      },
      orderBy: { sceneNumber: 'desc' }
    })

    return NextResponse.json({ scenes })
  } catch (error) {
    console.error('Error fetching scenes:', error)
    return NextResponse.json(
      { error: 'Failed to fetch scenes' },
      { status: 500 }
    )
  }
}
