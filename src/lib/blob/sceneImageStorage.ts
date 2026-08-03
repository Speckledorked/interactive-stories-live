// src/lib/blob/sceneImageStorage.ts
// #96: thin Vercel Blob upload wrapper. The image-generation provider's
// own response (base64 or a short-lived URL, depending on the model) is
// never durable — this uploads it once, immediately, so SceneImage.imageUrl
// always stores OUR permanent Blob URL instead.
//
// No client to lazily construct here (unlike OpenAI/Stripe): `put` is a
// plain function that reads `BLOB_READ_WRITE_TOKEN` from the environment
// at call time, so there's nothing to crash at import time in an
// environment without the token set — it simply throws when actually
// called, same effective behavior as the lazy-getter pattern elsewhere in
// this codebase, with less code.

import { put } from '@vercel/blob'

/**
 * Uploads a generated scene image and returns its permanent, public URL.
 * Throws on failure — callers (imageGenQueue.ts) own retry bookkeeping,
 * the same contract generateSceneImage has.
 */
export async function uploadSceneImage(sceneId: string, imageBuffer: Buffer, contentType: string): Promise<string> {
  const extension = contentType === 'image/png' ? 'png' : 'jpg'
  const blob = await put(`scene-images/${sceneId}.${extension}`, imageBuffer, {
    access: 'public',
    contentType,
    // A scene resolves at most a small number of times with images
    // enabled (one per scene, gated to the first exchange) — allow a
    // retry after a prior failed attempt to overwrite rather than
    // erroring on an existing pathname.
    allowOverwrite: true,
  })
  return blob.url
}
