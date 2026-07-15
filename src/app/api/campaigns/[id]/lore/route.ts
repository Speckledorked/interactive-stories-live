// src/app/api/campaigns/[id]/lore/route.ts
// Lore import: campaign admins add reference material (pasted text, a
// single page URL, or a whole MediaWiki wiki) that gets chunked, embedded,
// and made retrievable to the AI GM during play (see lib/ai/loreRetrieval.ts).

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { LORE_IMPORT_LIMIT, checkRateLimit, rateLimitExceededResponse } from '@/lib/rateLimit'
import { kickLoreImportJob, recoverStaleLoreJobs } from '@/lib/lore/loreQueue'

const MAX_PASTE_CHARS = 200_000

async function requireAdmin(request: NextRequest, campaignId: string) {
  const user = await getUser(request)
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const

  const membership = await prisma.campaignMembership.findUnique({
    where: { userId_campaignId: { userId: user.userId, campaignId } },
  })
  if (!membership || membership.role !== 'ADMIN') {
    return { error: NextResponse.json({ error: 'Only campaign admins can manage lore' }, { status: 403 }) } as const
  }
  return { user } as const
}

// GET /api/campaigns/:id/lore - List all lore import sources (jobs) for a campaign
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const campaignId = params.id
    const auth = await requireAdmin(request, campaignId)
    if (auth.error) return auth.error

    await recoverStaleLoreJobs(campaignId)

    const jobs = await prisma.loreImportJob.findMany({
      where: { campaignId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        sourceType: true,
        sourceUrl: true,
        sourceTitle: true,
        status: true,
        lastError: true,
        pagesFound: true,
        pagesDone: true,
        entriesCreated: true,
        createdAt: true,
        finishedAt: true,
      },
    })

    return NextResponse.json({ jobs })
  } catch (error) {
    console.error('Get lore jobs error:', error)
    return NextResponse.json({ error: 'Failed to get lore sources' }, { status: 500 })
  }
}

// POST /api/campaigns/:id/lore - Import a new lore source (paste, URL, or wiki)
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const campaignId = params.id
    const auth = await requireAdmin(request, campaignId)
    if (auth.error) return auth.error

    const rateLimit = await checkRateLimit(
      auth.user.userId, LORE_IMPORT_LIMIT.bucket, LORE_IMPORT_LIMIT.limit, LORE_IMPORT_LIMIT.windowSeconds
    )
    if (!rateLimit.allowed) return rateLimitExceededResponse(rateLimit)

    const body = await request.json()
    const sourceType = body?.sourceType

    if (!['PASTE', 'URL', 'WIKI'].includes(sourceType)) {
      return NextResponse.json({ error: 'sourceType must be PASTE, URL, or WIKI' }, { status: 400 })
    }

    let rawText: string | null = null
    let sourceUrl: string | null = null

    if (sourceType === 'PASTE') {
      rawText = typeof body?.rawText === 'string' ? body.rawText.trim() : ''
      if (!rawText) {
        return NextResponse.json({ error: 'rawText is required for a pasted lore source' }, { status: 400 })
      }
      if (rawText.length > MAX_PASTE_CHARS) {
        return NextResponse.json({ error: `Pasted text is too long (max ${MAX_PASTE_CHARS.toLocaleString()} characters)` }, { status: 400 })
      }
    } else {
      const urlCandidate = typeof body?.sourceUrl === 'string' ? body.sourceUrl.trim() : ''
      try {
        new URL(urlCandidate)
      } catch {
        return NextResponse.json({ error: 'A valid sourceUrl is required' }, { status: 400 })
      }
      sourceUrl = urlCandidate
    }

    const sourceTitle = typeof body?.sourceTitle === 'string' && body.sourceTitle.trim()
      ? body.sourceTitle.trim().slice(0, 200)
      : null

    const job = await prisma.loreImportJob.create({
      data: { campaignId, sourceType, sourceUrl, sourceTitle, rawText },
    })

    await kickLoreImportJob(job.id)

    return NextResponse.json({ job }, { status: 201 })
  } catch (error) {
    console.error('Create lore import job error:', error)
    return NextResponse.json({ error: 'Failed to start lore import' }, { status: 500 })
  }
}
