// src/lib/jobs/kickInternalWorker.ts
// Shared "hand a job to its own invocation" mechanics, factored out of
// resolutionQueue.ts/imageGenQueue.ts/loreQueue.ts/reseedQueue.ts/
// campaignHeroImage.ts, which all independently reimplemented the exact
// same self-fetch-with-abort-timeout shape. See resolutionQueue.ts's
// original kickJob doc comment for the full reasoning this preserves:
// delivery (not completion) is what the caller waits for, and a response
// that arrives before the abort fires is necessarily a fast one — the
// real work always takes far longer than KICK_DELIVERY_TIMEOUT_MS.
//
// A non-OK response and a thrown (non-abort) error are both treated as
// "the job was never handed off" and both call onDeliveryFailed if one
// was passed (#120). Omitting onDeliveryFailed — as reseedQueue.ts's
// kickReseedJob deliberately does — means a failed kick just leaves the
// job PENDING for the next recovery sweep, with no inline fallback at
// all; that omission is a caller's deliberate choice, not a gap in this
// helper.

import { getJwtSecret } from '@/lib/auth'
import { getAppUrl } from '@/lib/appUrl'

const KICK_DELIVERY_TIMEOUT_MS = 3000

export function internalJobSecret(): string {
  // Falls back to the JWT secret, which itself refuses to run in
  // production without a real value (see lib/auth.ts) — no hardcoded
  // fallback can reach production either way.
  return process.env.INTERNAL_JOB_SECRET || getJwtSecret()
}

/**
 * POST `body` to the internal worker route at `path`, waiting only long
 * enough to deliver the request (not for it to complete). On a non-OK
 * response or a thrown non-AbortError, calls `onDeliveryFailed` if one
 * was provided — the caller's own inline-processing fallback.
 */
export async function kickInternalWorker(
  path: string,
  body: Record<string, unknown>,
  onDeliveryFailed?: () => Promise<unknown>
): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), KICK_DELIVERY_TIMEOUT_MS)
  try {
    const response = await fetch(`${getAppUrl()}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': internalJobSecret(),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!response.ok) {
      console.error(`Worker kick to ${path} got a non-OK response (${response.status})`)
      await onDeliveryFailed?.()
    }
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') {
      // Delivered; we just stopped waiting for the (long) response.
      return
    }
    console.error(`Worker kick to ${path} failed:`, error)
    await onDeliveryFailed?.()
  } finally {
    clearTimeout(timer)
  }
}
