// src/app/api/internal/create-campaign/route.ts
// Internal worker route for async campaign creation (#493). Not
// user-facing: invoked by campaignCreationQueue.kickJob() (self-invocation
// over HTTP) so the five model calls and the seeding transaction run in
// their own invocation instead of inside the POST a player is waiting on.
// Auth is the same shared internal secret the resolve-job worker uses,
// never a user token.

import { NextRequest, NextResponse } from 'next/server'
import { internalJobSecret } from '@/lib/game/resolutionQueue'
import { processCampaignCreationJob } from '@/lib/game/campaignCreationQueue'

// Five model calls plus a seeding transaction. The same ceiling the
// resolve-job worker runs under, for the same reason: this is the whole
// point of moving the work off the request.
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

  return NextResponse.json(await processCampaignCreationJob(jobId))
}
