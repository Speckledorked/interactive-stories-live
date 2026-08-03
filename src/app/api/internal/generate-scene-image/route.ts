// src/app/api/internal/generate-scene-image/route.ts
// Internal worker route for async scene illustration (#96). Not
// user-facing: invoked by imageGenQueue.kickImageJob() (self-invocation
// over HTTP) so the image-generation-plus-upload pipeline runs in its own
// invocation instead of inside sceneResolver's request. Auth is the same
// shared internal secret every other worker route uses, never a user token.

import { NextRequest, NextResponse } from 'next/server'
import { processImageGenJob, sweepGloballyStuckImageJobs } from '@/lib/game/imageGenQueue'
import { internalJobSecret } from '@/lib/game/resolutionQueue'

// Generous ceiling for one image-generation call plus one Blob upload —
// far under resolve-job's 300s (that pipeline is a whole AI narration
// plus world turn), but real headroom over the expected single-digit-
// seconds happy path.
export const maxDuration = 120

export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-internal-secret')
  if (!secret || secret !== internalJobSecret()) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let jobId: string | undefined
  try {
    const body = await request.json()
    jobId = body?.jobId
  } catch {
    // fall through to the validation below
  }
  if (!jobId || typeof jobId !== 'string') {
    return NextResponse.json({ error: 'jobId is required' }, { status: 400 })
  }

  const result = await processImageGenJob(jobId)

  // Same instrumentation convention as resolve-job/route.ts: this worker
  // fires on any real scene-image generation across the whole app, so
  // it's a good place to also glance at every campaign for anything long
  // stuck. Awaited, not fire-and-forget, for the same reason — a
  // serverless function can freeze before a detached promise finishes.
  await sweepGloballyStuckImageJobs()

  return NextResponse.json(result)
}
