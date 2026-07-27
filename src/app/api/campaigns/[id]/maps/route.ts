import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/auth'
import { MapService } from '@/lib/maps/map-service'
import { getCampaignMembership } from '@/lib/db/campaignAccess'

// GET /api/campaigns/[id]/maps - List all maps for a campaign
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Called-out fix, not a silent behavior change: see quests/route.ts's
    // comment — hand-rolled token parsing here bypassed session revocation.
    const user = await getUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const campaignId = params.id

    // Verify user is a member of the campaign
    const membership = await getCampaignMembership(user.userId, campaignId)

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
    // Called-out fix, not a silent behavior change: see quests/route.ts's
    // comment — hand-rolled token parsing here bypassed session revocation.
    const user = await getUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const campaignId = params.id

    // Any member can create maps — shared table content, not a GM power
    // (there is no human GM in this product; every human is a player).
    const membership = await getCampaignMembership(user.userId, campaignId)

    if (!membership) {
      return NextResponse.json({ error: 'Not a member of this campaign' }, { status: 403 })
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
