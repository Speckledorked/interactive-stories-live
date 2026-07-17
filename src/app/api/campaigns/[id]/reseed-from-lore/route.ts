// src/app/api/campaigns/[id]/reseed-from-lore/route.ts
// Manual trigger for lore-aware world generation. The logic (and the
// fresh-vs-live merge semantics) lives in lib/lore/reseedWorld.ts, shared
// with the automatic creation-time path — campaigns created WITH a lore
// source reseed themselves when the import finishes; this route is the
// re-run / added-lore-later button (Admin → Lore).
//
// Async: reseedWorldFromLore makes up to two sequential AI calls, which
// for a large lore corpus can outrun a single serverless invocation's
// time budget (surfaced as a 502 to the admin, with no clean error — see
// lib/lore/reseedQueue.ts). POST creates a ReseedJob and kicks its worker
// invocation, returning immediately; GET polls that job's status, mirroring
// the lore-import job pattern (api/campaigns/[id]/lore/route.ts).

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { kickReseedJob, recoverStaleReseedJobs } from '@/lib/lore/reseedQueue'
import { AI_ACTION_LIMIT, checkRateLimit, rateLimitExceededResponse } from '@/lib/rateLimit'

async function requireAdmin(request: NextRequest, campaignId: string) {
  const user = await getUser(request)
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const

  const membership = await prisma.campaignMembership.findUnique({
    where: { userId_campaignId: { userId: user.userId, campaignId } },
  })
  if (!membership || membership.role !== 'ADMIN') {
    return { error: NextResponse.json({ error: 'Only campaign admins can reseed the world' }, { status: 403 }) } as const
  }
  return { user } as const
}

// GET /api/campaigns/:id/reseed-from-lore - Poll the most recent reseed job
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const campaignId = params.id
    const auth = await requireAdmin(request, campaignId)
    if (auth.error) return auth.error

    await recoverStaleReseedJobs(campaignId)

    const job = await prisma.reseedJob.findFirst({
      where: { campaignId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, status: true, lastError: true, summary: true,
        createdAt: true, finishedAt: true,
      },
    })

    return NextResponse.json({ job })
  } catch (error) {
    console.error('Get reseed job error:', error)
    return NextResponse.json({ error: 'Failed to get reseed status' }, { status: 500 })
  }
}

// POST /api/campaigns/:id/reseed-from-lore - Start a reseed job
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const campaignId = params.id
    const auth = await requireAdmin(request, campaignId)
    if (auth.error) return auth.error

    const rateLimit = await checkRateLimit(
      auth.user.userId, AI_ACTION_LIMIT.bucket, AI_ACTION_LIMIT.limit, AI_ACTION_LIMIT.windowSeconds
    )
    if (!rateLimit.allowed) return rateLimitExceededResponse(rateLimit)

    // Cheap synchronous pre-check so the obvious "nothing to reseed from"
    // case still gets an immediate, specific error instead of a job that's
    // created only to fail — the real work (the AI calls) is what needs
    // to run off the request path, not this.
    const hasLore = await prisma.loreEntry.findFirst({ where: { campaignId }, select: { id: true } })
    if (!hasLore) {
      return NextResponse.json(
        { error: 'No imported lore to reseed from — import lore first (Admin → Lore).' },
        { status: 400 }
      )
    }

    const job = await prisma.reseedJob.create({ data: { campaignId } })
    await kickReseedJob(job.id)

    return NextResponse.json({ job }, { status: 202 })
  } catch (error) {
    console.error('Reseed-from-lore error:', error)
    return NextResponse.json({ error: 'Failed to start world reseed' }, { status: 500 })
  }
}
