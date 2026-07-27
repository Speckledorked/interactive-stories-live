// src/app/api/campaigns/[id]/chronicle-share/route.ts
// GM-controlled toggle for the read-only public chronicle link (README's
// own #15 roadmap item) — off by default. Enabling mints a fresh token;
// disabling clears it rather than just flipping a flag, so re-enabling
// later can't accidentally resurrect an old, possibly-shared link.

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { UserRole } from '@prisma/client'
import crypto from 'crypto'
import { getCampaignMembership } from '@/lib/db/campaignAccess'
import { handleRouteError } from '@/lib/api/errors'

async function requireAdmin(userId: string, campaignId: string) {
  const membership = await getCampaignMembership(userId, campaignId)
  return membership?.role === UserRole.ADMIN
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await requireAuth(request)
    const campaignId = params.id

    if (!(await requireAdmin(user.userId, campaignId))) {
      return NextResponse.json({ error: 'Only admins can manage the chronicle share link' }, { status: 403 })
    }

    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { chronicleShareEnabled: true, chronicleShareToken: true },
    })
    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }

    return NextResponse.json({
      enabled: campaign.chronicleShareEnabled,
      token: campaign.chronicleShareEnabled ? campaign.chronicleShareToken : null,
    })
  } catch (error) {
    return handleRouteError(error, 'Get chronicle share error', 'Failed to load chronicle share state')
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await requireAuth(request)
    const campaignId = params.id

    if (!(await requireAdmin(user.userId, campaignId))) {
      return NextResponse.json({ error: 'Only admins can manage the chronicle share link' }, { status: 403 })
    }

    const token = crypto.randomBytes(24).toString('base64url')
    const campaign = await prisma.campaign.update({
      where: { id: campaignId },
      data: { chronicleShareEnabled: true, chronicleShareToken: token },
      select: { chronicleShareToken: true },
    })

    return NextResponse.json({ enabled: true, token: campaign.chronicleShareToken })
  } catch (error) {
    return handleRouteError(error, 'Enable chronicle share error', 'Failed to enable chronicle share')
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await requireAuth(request)
    const campaignId = params.id

    if (!(await requireAdmin(user.userId, campaignId))) {
      return NextResponse.json({ error: 'Only admins can manage the chronicle share link' }, { status: 403 })
    }

    await prisma.campaign.update({
      where: { id: campaignId },
      data: { chronicleShareEnabled: false, chronicleShareToken: null },
    })

    return NextResponse.json({ enabled: false, token: null })
  } catch (error) {
    return handleRouteError(error, 'Disable chronicle share error', 'Failed to disable chronicle share')
  }
}
