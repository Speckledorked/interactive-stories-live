// src/app/api/campaigns/[id]/reports/[reportId]/route.ts
// GM resolution of a queued content report.

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { UserRole } from '@prisma/client'
import { SafetyService } from '@/lib/safety/safety-service'

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; reportId: string } }
) {
  try {
    const user = requireAuth(request)
    const campaignId = params.id

    const membership = await prisma.campaignMembership.findUnique({
      where: { userId_campaignId: { userId: user.userId, campaignId } },
    })
    if (!membership || membership.role !== UserRole.ADMIN) {
      return NextResponse.json({ error: 'Only admins can act on reports' }, { status: 403 })
    }

    const existing = await prisma.contentReport.findUnique({ where: { id: params.reportId } })
    if (!existing || existing.campaignId !== campaignId) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 })
    }

    const body = await request.json()
    const { action, resolution, actionTaken } = body

    if (action === 'resolve') {
      if (typeof resolution !== 'string' || !resolution.trim()) {
        return NextResponse.json({ error: 'A resolution note is required' }, { status: 400 })
      }
      const report = await SafetyService.resolveReport(
        params.reportId,
        user.userId,
        resolution.trim().slice(0, 2000),
        typeof actionTaken === 'string' ? actionTaken.slice(0, 100) : undefined
      )
      return NextResponse.json({ report })
    }

    if (action === 'dismiss') {
      const report = await SafetyService.dismissReport(
        params.reportId,
        user.userId,
        typeof resolution === 'string' ? resolution.trim().slice(0, 2000) : 'Dismissed'
      )
      return NextResponse.json({ report })
    }

    return NextResponse.json({ error: 'action must be "resolve" or "dismiss"' }, { status: 400 })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('Update report error:', error)
    return NextResponse.json({ error: 'Failed to update report' }, { status: 500 })
  }
}
