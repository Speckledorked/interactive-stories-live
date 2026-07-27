// src/app/api/campaigns/[id]/members/[userId]/ban/route.ts
// GM bans a disruptive player from the campaign — unlike plain "Remove"
// (members/[userId] DELETE), a ban is logged with a reason and blocks
// rejoining via invite link (see join/[token]/route.ts).

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { UserRole } from '@prisma/client'
import { SafetyService } from '@/lib/safety/safety-service'
import { getCampaignMembership } from '@/lib/db/campaignAccess'
import { handleRouteError } from '@/lib/api/errors'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string; userId: string } }
) {
  try {
    const user = await requireAuth(request)
    const campaignId = params.id
    const targetUserId = params.userId

    if (targetUserId === user.userId) {
      return NextResponse.json({ error: 'You cannot ban yourself' }, { status: 400 })
    }

    const adminMembership = await getCampaignMembership(user.userId, campaignId)
    if (!adminMembership || adminMembership.role !== UserRole.ADMIN) {
      return NextResponse.json({ error: 'Only admins can ban members' }, { status: 403 })
    }

    const targetMembership = await getCampaignMembership(targetUserId, campaignId)
    if (!targetMembership) {
      return NextResponse.json({ error: 'User is not a member of this campaign' }, { status: 404 })
    }

    if (targetMembership.role === UserRole.ADMIN) {
      return NextResponse.json({ error: 'Demote this admin to Player before banning them' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const { reason, isPermanent, expiresAt } = body

    if (typeof reason !== 'string' || !reason.trim()) {
      return NextResponse.json({ error: 'A reason is required' }, { status: 400 })
    }

    const ban = await SafetyService.banUserFromCampaign(
      campaignId,
      targetUserId,
      user.userId,
      reason.trim().slice(0, 1000),
      Boolean(isPermanent),
      expiresAt ? new Date(expiresAt) : undefined
    )

    return NextResponse.json({ ban })
  } catch (error) {
    return handleRouteError(error, 'Ban member error', 'Failed to ban member')
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; userId: string } }
) {
  try {
    const user = await requireAuth(request)
    const campaignId = params.id

    const adminMembership = await getCampaignMembership(user.userId, campaignId)
    if (!adminMembership || adminMembership.role !== UserRole.ADMIN) {
      return NextResponse.json({ error: 'Only admins can unban members' }, { status: 403 })
    }

    await SafetyService.unbanUserFromCampaign(campaignId, params.userId)
    return NextResponse.json({ success: true })
  } catch (error) {
    return handleRouteError(error, 'Unban member error', 'Failed to unban member')
  }
}
