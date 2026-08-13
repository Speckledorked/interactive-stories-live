import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getCampaignMembership } from '@/lib/db/campaignAccess'

// #234: this route used to fetch a campaign's ENTIRE Story Log — every
// scene/downtime/milestone entry ever written, unbounded — on every load
// of the lobby's Progression tab. Fine for a young campaign, a real cost
// (and eventually a real page-load stall) for a long-running one.
//
// Cursor-based, not offset-based: offset pagination (skip/take from the
// newest end, the pattern messages/route.ts already uses) drifts under
// concurrent writes — new entries keep landing at the tail of this list
// while a campaign is actively played, which shifts every subsequent
// "page" by however many new rows appeared since the last fetch. A
// cursor anchored to a specific already-seen row's (turnNumber,
// createdAt) has no such drift: "everything strictly older than this row"
// means the same thing regardless of what's been appended since.
//
// turnNumber alone isn't a stable sort key — a milestone entry and the
// scene entry that triggered it can share a turnNumber — so every
// ordering/cursor comparison here breaks ties with createdAt.
const DEFAULT_LOG_PAGE_SIZE = 30
const MAX_LOG_PAGE_SIZE = 100

// GET /api/campaigns/[id]/logs - Get a page of the campaign's story log,
// newest page first (?before=<logId> walks further into the past).
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Called-out fix, not a silent behavior change: see quests/route.ts's
    // comment — hand-rolled token parsing here bypassed session revocation.
    const user = await getUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const campaignId = params.id

    // Verify user is a member of the campaign
    const membership = await getCampaignMembership(user.userId, campaignId)

    if (!membership) {
      return NextResponse.json({ error: 'Not a member of this campaign' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const requestedLimit = parseInt(searchParams.get('limit') || '', 10)
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, MAX_LOG_PAGE_SIZE)
      : DEFAULT_LOG_PAGE_SIZE
    const beforeId = searchParams.get('before')

    const where: Record<string, unknown> = { campaignId }
    if (beforeId) {
      const anchor = await prisma.campaignLog.findFirst({
        where: { id: beforeId, campaignId },
        select: { turnNumber: true, createdAt: true },
      })
      if (!anchor) {
        return NextResponse.json({ error: 'Invalid pagination cursor' }, { status: 400 })
      }
      where.OR = [
        { turnNumber: { lt: anchor.turnNumber } },
        { turnNumber: anchor.turnNumber, createdAt: { lt: anchor.createdAt } },
      ]
    }

    const [page, sceneCount] = await Promise.all([
      prisma.campaignLog.findMany({
        where,
        orderBy: [{ turnNumber: 'desc' }, { createdAt: 'desc' }],
        take: limit,
      }),
      // Campaign-wide, independent of which page is loaded — the lobby's
      // milestone progress bar needs the real total, not just what's
      // currently in view (see campaigns/[id]/page.tsx).
      prisma.campaignLog.count({ where: { campaignId, entryType: 'scene' } }),
    ])

    return NextResponse.json({
      logs: page.reverse(), // oldest-first within the page, matching the UI's chronological read order
      hasMore: page.length === limit,
      sceneCount,
    })
  } catch (error) {
    console.error('Error fetching campaign logs:', error)
    return NextResponse.json({ error: 'Failed to fetch campaign logs' }, { status: 500 })
  }
}

// POST /api/campaigns/[id]/logs - Create a campaign log entry
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Called-out fix, not a silent behavior change: see quests/route.ts's
    // comment — hand-rolled token parsing here bypassed session revocation.
    const user = await getUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const campaignId = params.id

    // Verify user is admin of the campaign (only admins/AI can create logs)
    const membership = await prisma.campaignMembership.findFirst({
      where: {
        campaignId,
        userId: user.userId,
        role: 'ADMIN'
      }
    })

    if (!membership) {
      return NextResponse.json({ error: 'Only campaign admins can create log entries' }, { status: 403 })
    }

    const body = await request.json()
    const { sceneId, turnNumber, title, summary, highlights, entryType, inGameDate, duration } = body

    const log = await prisma.campaignLog.create({
      data: {
        campaignId,
        sceneId,
        turnNumber,
        title,
        summary,
        highlights: highlights || [],
        entryType: entryType || 'scene',
        inGameDate,
        duration
      }
    })

    return NextResponse.json({ log }, { status: 201 })
  } catch (error) {
    console.error('Error creating campaign log:', error)
    return NextResponse.json({ error: 'Failed to create campaign log' }, { status: 500 })
  }
}
