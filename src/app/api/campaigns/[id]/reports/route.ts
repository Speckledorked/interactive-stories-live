// src/app/api/campaigns/[id]/reports/route.ts
// Content reporting — any member can flag a specific message/character/
// scene/user's behavior for GM review. Distinct from the X-Card (which is
// "pause, I'm uncomfortable, no reason needed") — a report is "this needs
// moderator attention," always requires a reason, and stays queued until
// a GM resolves or dismisses it.

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { UserRole, ReportStatus, ReportSeverity } from '@prisma/client'
import { SafetyService } from '@/lib/safety/safety-service'

const VALID_CONTENT_TYPES = ['message', 'note', 'character', 'scene', 'user_behavior', 'other']

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = requireAuth(request)
    const campaignId = params.id

    const membership = await prisma.campaignMembership.findUnique({
      where: { userId_campaignId: { userId: user.userId, campaignId } },
    })
    if (!membership) {
      return NextResponse.json({ error: 'Not a member of this campaign' }, { status: 403 })
    }

    const body = await request.json()
    const { contentType, contentId, contentText, reason, category } = body

    if (!contentType || !VALID_CONTENT_TYPES.includes(contentType)) {
      return NextResponse.json({ error: 'Invalid content type' }, { status: 400 })
    }
    if (typeof reason !== 'string' || !reason.trim()) {
      return NextResponse.json({ error: 'A reason is required' }, { status: 400 })
    }

    const report = await SafetyService.reportContent(
      user.userId,
      campaignId,
      contentType,
      contentId || null,
      reason.trim().slice(0, 2000),
      typeof category === 'string' ? category.slice(0, 100) : undefined,
      ReportSeverity.MEDIUM,
      typeof contentText === 'string' ? contentText.slice(0, 2000) : undefined
    )

    return NextResponse.json({ report })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('Create report error:', error)
    return NextResponse.json({ error: 'Failed to submit report' }, { status: 500 })
  }
}

// GM-only: the moderation queue for this campaign.
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = requireAuth(request)
    const campaignId = params.id

    const membership = await prisma.campaignMembership.findUnique({
      where: { userId_campaignId: { userId: user.userId, campaignId } },
    })
    if (!membership || membership.role !== UserRole.ADMIN) {
      return NextResponse.json({ error: 'Only admins can view reports' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const statusParam = searchParams.get('status')
    const status = statusParam && Object.values(ReportStatus).includes(statusParam as ReportStatus)
      ? (statusParam as ReportStatus)
      : undefined

    const reports = await SafetyService.getReports(campaignId, status)
    return NextResponse.json({ reports })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('List reports error:', error)
    return NextResponse.json({ error: 'Failed to load reports' }, { status: 500 })
  }
}
