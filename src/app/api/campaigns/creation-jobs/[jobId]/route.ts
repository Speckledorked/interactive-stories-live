// src/app/api/campaigns/creation-jobs/[jobId]/route.ts
//
// #493 — what the creation modal polls while the world is being built.
//
// Returns the stage and its sentence, and on completion the campaign id to
// navigate to. Scoped to the job's owner: a creation job carries the title
// and premise of a campaign that does not exist yet, which is nobody else's
// to read.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { STAGE_LABELS, type CreationStage } from '@/lib/game/campaignCreationQueue'

export async function GET(request: NextRequest, { params }: { params: { jobId: string } }) {
  try {
    const user = await getUser(request)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const job = await prisma.campaignCreationJob.findUnique({
      where: { id: params.jobId },
      select: { userId: true, status: true, stage: true, campaignId: true, lastError: true },
    })

    // 404 rather than 403 for someone else's job: distinguishing the two
    // would turn this route into a way to confirm a job id exists.
    if (!job || job.userId !== user.userId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    return NextResponse.json({
      status: job.status,
      stage: job.stage,
      label: STAGE_LABELS[job.stage as CreationStage],
      campaignId: job.campaignId,
      // Only on a terminal failure. A PENDING job carrying lastError is
      // mid-retry, and showing that error would report a failure to someone
      // whose campaign is still on its way.
      error: job.status === 'FAILED' ? job.lastError : null,
    })
  } catch (error) {
    console.error('Get creation job error:', error)
    return NextResponse.json({ error: 'Failed to get creation status' }, { status: 500 })
  }
}
