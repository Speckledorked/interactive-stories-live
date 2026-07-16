// src/app/api/admin/analytics/route.ts
// #12 alpha instrumentation — platform-wide funnel/retention dashboard
// data, plus a glance at globally stuck jobs. Gated by PLATFORM_ADMIN_EMAILS
// (lib/auth/platformAdmin.ts), not campaign membership — this is the
// operator's view across every campaign, not any one GM's.

import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/auth'
import { isPlatformAdminEmail } from '@/lib/auth/platformAdmin'
import { prisma } from '@/lib/prisma'
import { getFunnelCounts, getSignupsByDay, getRetentionByCohortWeek } from '@/lib/analytics/events'

export async function GET(request: NextRequest) {
  const user = await getUser(request)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!isPlatformAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  }

  const [funnel, signupsByDay, retention, stuckResolutionJobs, stuckLoreJobs] = await Promise.all([
    getFunnelCounts(),
    getSignupsByDay(30),
    getRetentionByCohortWeek(8),
    prisma.resolutionJob.findMany({
      where: { OR: [{ alertedStuckAt: { not: null } }, { status: 'FAILED', lastError: { contains: 'Abandoned' } }] },
      select: { id: true, campaignId: true, sceneId: true, status: true, lastError: true, updatedAt: true, alertedStuckAt: true },
      orderBy: { updatedAt: 'desc' },
      take: 20,
    }),
    prisma.loreImportJob.findMany({
      where: { OR: [{ alertedStuckAt: { not: null } }, { status: 'FAILED', lastError: { contains: 'Abandoned' } }] },
      select: { id: true, campaignId: true, sourceType: true, status: true, lastError: true, updatedAt: true, alertedStuckAt: true },
      orderBy: { updatedAt: 'desc' },
      take: 20,
    }),
  ])

  return NextResponse.json({ funnel, signupsByDay, retention, stuckResolutionJobs, stuckLoreJobs })
}
