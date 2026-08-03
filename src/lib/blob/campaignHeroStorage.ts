// src/lib/blob/campaignHeroStorage.ts
// Thin Vercel Blob upload wrapper for the campaign lobby hero banner —
// sibling to sceneImageStorage.ts, kept as its own file (not a shared
// generalized function) so each blob-path convention stays explicit,
// matching this codebase's existing one-function-per-purpose style here.

import { put } from '@vercel/blob'

/**
 * Uploads a generated campaign hero image and returns its permanent,
 * public URL. Throws on failure — the caller (campaignHeroImage.ts) owns
 * setting Campaign.heroImageStatus to FAILED.
 */
export async function uploadCampaignHeroImage(campaignId: string, imageBuffer: Buffer, contentType: string): Promise<string> {
  const extension = contentType === 'image/png' ? 'png' : 'jpg'
  const blob = await put(`campaign-hero/${campaignId}.${extension}`, imageBuffer, {
    access: 'public',
    contentType,
    // A campaign generates its hero image at most a handful of times
    // (creation, plus a possible manual retry after a failure) — allow
    // overwriting rather than erroring on an existing pathname.
    allowOverwrite: true,
  })
  return blob.url
}
