// src/app/api/campaigns/[id]/safety-settings/route.ts
// GM-configurable X-Card/lines-and-veils settings (see lib/safety/safety-service.ts).
// Previously had no route at all — every campaign silently ran on hardcoded
// defaults forever, invisible to the GM who might believe they'd configured it.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { SafetyService } from '@/lib/safety/safety-service'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
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

    if (!membership) {
      return NextResponse.json({ error: 'Not a member of this campaign' }, { status: 403 })
    }

    const settings = await SafetyService.getCampaignSafety(campaignId)
    return NextResponse.json(settings)
  } catch (error) {
    console.error('Get safety settings error:', error)
    return NextResponse.json({ error: 'Failed to get safety settings' }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
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
      return NextResponse.json({ error: 'Only campaign admins can change safety settings' }, { status: 403 })
    }

    const body = await request.json()
    const settings = await SafetyService.updateSafetySettings(campaignId, {
      xCardEnabled: typeof body.xCardEnabled === 'boolean' ? body.xCardEnabled : undefined,
      anonymousXCard: typeof body.anonymousXCard === 'boolean' ? body.anonymousXCard : undefined,
      pauseOnXCard: typeof body.pauseOnXCard === 'boolean' ? body.pauseOnXCard : undefined,
      xCardNotifyGMOnly: typeof body.xCardNotifyGMOnly === 'boolean' ? body.xCardNotifyGMOnly : undefined,
      lines: Array.isArray(body.lines) ? body.lines.filter((l: unknown) => typeof l === 'string') : undefined,
      veils: Array.isArray(body.veils) ? body.veils.filter((v: unknown) => typeof v === 'string') : undefined,
    })

    return NextResponse.json(settings)
  } catch (error) {
    console.error('Update safety settings error:', error)
    return NextResponse.json({ error: 'Failed to update safety settings' }, { status: 500 })
  }
}
