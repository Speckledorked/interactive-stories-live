// src/app/api/campaigns/[id]/hero-image/route.ts
// Manual/admin backfill for a campaign's lobby hero banner. The only
// existing trigger (kickCampaignHeroImage, see campaignHeroImage.ts) fires
// once, at campaign creation — a campaign created before that feature
// shipped (or one whose generation failed) has no other way to ever get
// one. This is that other way: admin-only, re-uses the existing
// generation function unchanged.
import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/auth'
import { requireCampaignAdmin } from '@/lib/db/campaignAccess'
import { kickCampaignHeroImage } from '@/lib/game/campaignHeroImage'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const campaignId = params.id

    const adminCheck = await requireCampaignAdmin(user.userId, campaignId, 'Only campaign admins can generate hero art')
    if ('response' in adminCheck) return adminCheck.response

    kickCampaignHeroImage(campaignId).catch((err) => console.error('Hero image kick failed:', err))

    return NextResponse.json({ status: 'PENDING' }, { status: 202 })
  } catch (error) {
    console.error('Hero image backfill error:', error)
    return NextResponse.json({ error: 'Failed to start hero image generation' }, { status: 500 })
  }
}
