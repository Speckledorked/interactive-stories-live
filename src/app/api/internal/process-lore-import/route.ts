// src/app/api/internal/process-lore-import/route.ts
// Internal worker route for async lore import. Not user-facing: invoked
// by loreQueue.kickLoreImportJob() (self-invocation over HTTP) so a paste,
// URL fetch, or wiki crawl runs in its own invocation instead of inside an
// admin's request. Auth is a shared internal secret, never a user token.

import { NextRequest, NextResponse } from 'next/server'
import { processLoreImportJob } from '@/lib/lore/loreQueue'
import { internalJobSecret } from '@/lib/game/resolutionQueue'

// A wiki crawl (up to WIKI_MAX_PAGES) needs real headroom — same ceiling
// as scene resolution's worker route.
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

  const result = await processLoreImportJob(jobId)
  return NextResponse.json(result)
}
