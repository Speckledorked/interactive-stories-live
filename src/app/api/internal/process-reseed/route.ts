// src/app/api/internal/process-reseed/route.ts
// Internal worker route for async world reseed. Not user-facing: invoked
// by reseedQueue.kickReseedJob() (self-invocation over HTTP) so the two
// sequential AI calls inside reseedWorldFromLore run in their own
// invocation instead of inside an admin's request. Auth is a shared
// internal secret, never a user token.

import { NextRequest, NextResponse } from 'next/server'
import { processReseedJob, sweepGloballyStuckReseedJobs } from '@/lib/lore/reseedQueue'
import { internalJobSecret } from '@/lib/game/resolutionQueue'

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

  const result = await processReseedJob(jobId)

  // #12 alpha instrumentation — see resolve-job/route.ts's identical hook.
  await sweepGloballyStuckReseedJobs()

  return NextResponse.json(result)
}
