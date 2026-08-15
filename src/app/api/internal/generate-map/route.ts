// src/app/api/internal/generate-map/route.ts
// Internal worker route for async map generation (#291). Not user-facing:
// invoked by mapGenQueue.kickMapJob() (self-invocation over HTTP) so the
// scene-analysis-plus-zone/token-writes pipeline runs in its own invocation
// instead of inside sceneResolver's request. Auth is the same shared
// internal secret every other worker route uses, never a user token.

import { NextRequest, NextResponse } from 'next/server'
import { processMapGenJob, sweepGloballyStuckMapJobs } from '@/lib/game/mapGenQueue'
import { internalJobSecret } from '@/lib/game/resolutionQueue'

// Generous ceiling for one AI analysis call plus several sequential
// zone/token writes — no image generation/upload involved, so comfortably
// under generate-scene-image's own 120s.
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

  const result = await processMapGenJob(jobId)

  // Same instrumentation convention as generate-scene-image/route.ts: this
  // worker fires on any real map generation across the whole app, so it's
  // a good place to also glance at every campaign for anything long stuck.
  await sweepGloballyStuckMapJobs()

  return NextResponse.json(result)
}
