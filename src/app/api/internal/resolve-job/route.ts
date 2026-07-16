// src/app/api/internal/resolve-job/route.ts
// Internal worker route for async scene resolution. Not user-facing:
// invoked by resolutionQueue.kickJob() (self-invocation over HTTP) so the
// AI-GM-plus-world-turn pipeline runs in its own invocation instead of
// inside a player's request. Auth is a shared internal secret, never a
// user token.

import { NextRequest, NextResponse } from 'next/server'
import { processResolutionJob, internalJobSecret, sweepGloballyStuckResolutionJobs } from '@/lib/game/resolutionQueue'

// The whole point of this route: a ceiling high enough for the real
// pipeline (~150s resolution + world turn) with room to spare.
export const maxDuration = 300

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

  const result = await processResolutionJob(jobId)

  // #12 alpha instrumentation: this worker route fires on any real scene
  // resolution across the whole app, making it a good place to also glance
  // at every campaign for anything long stuck (see stuckJobAlert.ts).
  // Awaited, not fire-and-forget — a serverless function can freeze before
  // a detached promise finishes; the sweep is already fully guarded
  // against throwing, so awaiting it costs a little latency, never safety.
  await sweepGloballyStuckResolutionJobs()

  return NextResponse.json(result)
}
