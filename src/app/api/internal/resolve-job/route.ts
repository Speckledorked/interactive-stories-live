// src/app/api/internal/resolve-job/route.ts
// Internal worker route for async scene resolution. Not user-facing:
// invoked by resolutionQueue.kickJob() (self-invocation over HTTP) so the
// AI-GM-plus-world-turn pipeline runs in its own invocation instead of
// inside a player's request. Auth is a shared internal secret, never a
// user token.

import { NextRequest, NextResponse } from 'next/server'
import { processResolutionJob, internalJobSecret } from '@/lib/game/resolutionQueue'

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
  return NextResponse.json(result)
}
