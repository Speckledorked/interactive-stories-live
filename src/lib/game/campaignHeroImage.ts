// src/lib/game/campaignHeroImage.ts
// One-shot campaign lobby hero banner generation, kicked from
// campaignCreation.ts right after a campaign is created. See
// imageGeneration.ts's header comment for why this deliberately does NOT
// reuse imageGenQueue.ts's full job-queue machinery: a hero image is
// generated exactly once, at creation, purely cosmetic, and blocks
// nothing — the Campaign row's heroImageStatus IS the state machine, no
// separate job table needed.
//
// It DOES reuse the self-fetch-kick half of that pattern, though
// (kickCampaignHeroImage below, mirroring kickLoreImportJob exactly): a
// bare unawaited call from campaignCreation.ts is not safe to assume
// survives past the HTTP response on a serverless deployment target — the
// same reason every other "do real work after this request returns" path
// in this codebase (lore import, scene images) goes through a self-fetch
// kick to an internal route instead of trusting a detached promise.
//
// NEEDS VERIFICATION AGAINST REAL OPENAI_API_KEY/BLOB_READ_WRITE_TOKEN
// before relying on this in production — this sandbox has neither, same
// gap #96's scene illustration flagged.

import { prisma } from '@/lib/prisma'
import { buildCampaignHeroPrompt, generateHeroImage } from '@/lib/ai/imageGeneration'
import { uploadCampaignHeroImage } from '@/lib/blob/campaignHeroStorage'
import { kickInternalWorker } from '@/lib/jobs/kickInternalWorker'

/**
 * Hands hero-image generation to its own invocation via the internal
 * worker route, same reasoning as kickLoreImportJob/kickImageJob: a short
 * delivery timeout means this doesn't hold the caller's response, and a
 * failed/non-OK delivery falls back to processing inline rather than
 * silently losing the image.
 */
export async function kickCampaignHeroImage(campaignId: string): Promise<void> {
  await kickInternalWorker(
    '/api/internal/generate-campaign-hero-image',
    { campaignId },
    () => generateCampaignHeroImage(campaignId)
  )
}

/**
 * Generates and stores a campaign's hero banner image. Never throws —
 * any failure (no API key, API error, upload failure) leaves
 * heroImageStatus 'FAILED' and heroImageUrl null; the lobby's
 * CampaignHero simply renders without a banner either way.
 */
export async function generateCampaignHeroImage(campaignId: string): Promise<void> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { title: true, description: true, universe: true },
  })
  if (!campaign) return

  await prisma.campaign.update({ where: { id: campaignId }, data: { heroImageStatus: 'PENDING' } }).catch(console.error)

  try {
    const prompt = buildCampaignHeroPrompt(campaign)
    const { imageBuffer, contentType } = await generateHeroImage(campaignId, prompt)
    const imageUrl = await uploadCampaignHeroImage(campaignId, imageBuffer, contentType)

    await prisma.campaign.update({
      where: { id: campaignId },
      data: { heroImageUrl: imageUrl, heroImageStatus: 'READY' },
    })
  } catch (error) {
    console.error(`Hero image generation failed for campaign ${campaignId}:`, error)
    await prisma.campaign.update({ where: { id: campaignId }, data: { heroImageStatus: 'FAILED' } }).catch(console.error)
  }
}
