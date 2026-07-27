import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { getCampaignMembership } from '@/lib/db/campaignAccess'
import { handleRouteError } from '@/lib/api/errors'

// GET /api/campaigns/[id]/scenes - Get all scenes for a campaign
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await requireAuth(request)
    const campaignId = params.id

    // Verify user is a member of the campaign
    const membership = await getCampaignMembership(user.userId, campaignId)

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
    // Called-out fix, not a silent behavior change: see tutorial/trigger/
    // route.ts's comment — this route had the same missing 401 case.
    return handleRouteError(error, 'Error fetching scenes', 'Failed to fetch scenes')
  }
}
