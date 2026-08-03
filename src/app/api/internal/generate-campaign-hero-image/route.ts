// src/app/api/internal/generate-campaign-hero-image/route.ts
// Internal worker route for the one-shot campaign lobby hero banner.
// Invoked by campaignHeroImage.kickCampaignHeroImage() (self-invocation
// over HTTP) so image generation runs in its own invocation instead of
// inside the campaign-creation request. Same shared internal secret every
// other worker route uses, never a user token.

import { NextRequest, NextResponse } from 'next/server'
import { generateCampaignHeroImage } from '@/lib/game/campaignHeroImage'
import { internalJobSecret } from '@/lib/game/resolutionQueue'

// Generous ceiling for one image-generation call plus one Blob upload,
// same reasoning as generate-scene-image/route.ts's maxDuration.
export const maxDuration = 120

export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-internal-secret')
  if (!secret || secret !== internalJobSecret()) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let campaignId: string | undefined
  try {
    const body = await request.json()
    campaignId = body?.campaignId
  } catch {
    // fall through to the validation below
  }
  if (!campaignId || typeof campaignId !== 'string') {
    return NextResponse.json({ error: 'campaignId is required' }, { status: 400 })
  }

  await generateCampaignHeroImage(campaignId)

  return NextResponse.json({ status: 'done' })
}
