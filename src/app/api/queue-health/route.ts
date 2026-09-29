// src/app/api/queue-health/route.ts
// Resolution-queue diagnostics, sibling of /api/ai-health: shows the
// recent ResolutionJob rows for a campaign so "my action won't resolve"
// is answerable from a phone browser. Anonymous but rate-limited;
// the payload contains only job bookkeeping (status, attempts, truncated
// error text) — no story content, no user data.
//
// Members only (#509's defect class). This route is for a player debugging
// their own stuck action from a phone, so it checks campaign MEMBERSHIP
// rather than platform admin — gating it to the operator would delete the
// use case. What it does not do any more is take an unguessable id as
// authorisation: the id travels in the app's own URL bar, gets pasted into
// chat and bug reports, and most of all this handler WRITES —
// recoverStaleJobs re-kicks jobs — so "unguessable" was standing in for a
// permission check on a mutating endpoint.
//
// Usage: /api/queue-health?campaign=<campaign id from the app's URL>

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkRateLimit } from '@/lib/rateLimit'
import { recoverStaleJobs } from '@/lib/game/resolutionQueue'
import { getUser } from '@/lib/auth'
import { getCampaignMembership } from '@/lib/db/campaignAccess'

export const maxDuration = 30
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const user = await getUser(request)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Per-user, not the literal string 'anonymous'. The old key gave the
  // whole internet ONE shared bucket, so any caller could hold it at its
  // ceiling and deny the diagnostic to everyone else.
  const rateLimit = await checkRateLimit(user.userId, 'queue-health', 6, 60)
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: 'Too many checks — try again in a minute.' }, { status: 429 })
  }

  const campaignId = request.nextUrl.searchParams.get('campaign')
  if (!campaignId) {
    return NextResponse.json({
      error: 'Add ?campaign=<id> — copy the id from the app URL: /campaigns/<id>/story',
    }, { status: 400 })
  }

  // Before the sweep below, which is a write.
  const membership = await getCampaignMembership(user.userId, campaignId)
  if (!membership) {
    return NextResponse.json({ error: 'Not a member of this campaign' }, { status: 403 })
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
      RUNNING: 'MythOS is working on it right now',
      COMPLETED: 'done — the scene should show the resolution',
      FAILED: 'gave up after retries — lastError says why',
    },
    note: jobs.length === 0
      ? 'No jobs recorded for this campaign — the action submission never enqueued one (check the campaign id, or the submission itself failed).'
      : undefined,
  })
}
