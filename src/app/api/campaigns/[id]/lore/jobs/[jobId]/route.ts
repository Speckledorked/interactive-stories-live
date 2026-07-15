// src/app/api/campaigns/[id]/lore/jobs/[jobId]/route.ts
// Poll a single lore import job's status/progress — a wiki crawl can take
// a couple of minutes, so the admin UI polls this instead of the full
// list endpoint to track one in-flight import's progress bar.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string; jobId: string } }
) {
  try {
    const user = await getUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const campaignId = params.id
    const membership = await prisma.campaignMembership.findUnique({
      where: { userId_campaignId: { userId: user.userId, campaignId } },
    })
    if (!membership || membership.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Only campaign admins can view lore imports' }, { status: 403 })
    }

    const job = await prisma.loreImportJob.findFirst({
      where: { id: params.jobId, campaignId },
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
    if (!job) {
      return NextResponse.json({ error: 'Lore import job not found' }, { status: 404 })
    }

    return NextResponse.json({ job })
  } catch (error) {
    console.error('Get lore job error:', error)
    return NextResponse.json({ error: 'Failed to get lore import job' }, { status: 500 })
  }
}
