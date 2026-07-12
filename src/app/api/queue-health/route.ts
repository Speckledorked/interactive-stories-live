// src/app/api/queue-health/route.ts
// Resolution-queue diagnostics, sibling of /api/ai-health: shows the
// recent ResolutionJob rows for a campaign so "my action won't resolve"
// is answerable from a phone browser. Anonymous but rate-limited;
// campaign ids are unguessable cuids and the payload contains only job
// bookkeeping (status, attempts, truncated error text) — no story
// content, no user data.
//
// Usage: /api/queue-health?campaign=<campaign id from the app's URL>

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkRateLimit } from '@/lib/rateLimit'
import { recoverStaleJobs } from '@/lib/game/resolutionQueue'

export const maxDuration = 30
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const rateLimit = await checkRateLimit('anonymous', 'queue-health', 6, 60)
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: 'Too many checks — try again in a minute.' }, { status: 429 })
  }

  const campaignId = request.nextUrl.searchParams.get('campaign')
  if (!campaignId) {
    return NextResponse.json({
      error: 'Add ?campaign=<id> — copy the id from the app URL: /campaigns/<id>/story',
    }, { status: 400 })
  }

  // Visiting this page IS the retry loop: sweep stale jobs first so a
  // lost kick gets re-kicked by the very request investigating it.
  await recoverStaleJobs(campaignId)

  const jobs = await prisma.resolutionJob.findMany({
    where: { campaignId },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: {
      id: true,
      sceneId: true,
      status: true,
      attempts: true,
      lastError: true,
      createdAt: true,
      startedAt: true,
      finishedAt: true,
    },
  })

  return NextResponse.json({
    campaignId,
    jobCount: jobs.length,
    jobs: jobs.map(j => ({
      ...j,
      lastError: j.lastError ? j.lastError.slice(0, 300) : null,
    })),
    legend: {
      PENDING: 'queued, waiting for a worker (should start within seconds; this page just re-kicked any stale ones)',
      RUNNING: 'the AI GM is working on it right now',
      COMPLETED: 'done — the scene should show the resolution',
      FAILED: 'gave up after retries — lastError says why',
    },
    note: jobs.length === 0
      ? 'No jobs recorded for this campaign — the action submission never enqueued one (check the campaign id, or the submission itself failed).'
      : undefined,
  })
}
