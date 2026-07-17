// src/app/api/campaigns/[id]/members/[userId]/ban/route.ts
// GM bans a disruptive player from the campaign — unlike plain "Remove"
// (members/[userId] DELETE), a ban is logged with a reason and blocks
// rejoining via invite link (see join/[token]/route.ts).

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { UserRole } from '@prisma/client'
import { SafetyService } from '@/lib/safety/safety-service'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string; userId: string } }
) {
  try {
    const user = requireAuth(request)
    const campaignId = params.id
    const targetUserId = params.userId

    if (targetUserId === user.userId) {
      return NextResponse.json({ error: 'You cannot ban yourself' }, { status: 400 })
    }

    const adminMembership = await prisma.campaignMembership.findUnique({
      where: { userId_campaignId: { userId: user.userId, campaignId } },
    })
    if (!adminMembership || adminMembership.role !== UserRole.ADMIN) {
      return NextResponse.json({ error: 'Only admins can ban members' }, { status: 403 })
    }

    const targetMembership = await prisma.campaignMembership.findUnique({
      where: { userId_campaignId: { userId: targetUserId, campaignId } },
    })
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
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('Ban member error:', error)
    return NextResponse.json({ error: 'Failed to ban member' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; userId: string } }
) {
  try {
    const user = requireAuth(request)
    const campaignId = params.id

    const adminMembership = await prisma.campaignMembership.findUnique({
      where: { userId_campaignId: { userId: user.userId, campaignId } },
    })
    if (!adminMembership || adminMembership.role !== UserRole.ADMIN) {
      return NextResponse.json({ error: 'Only admins can unban members' }, { status: 403 })
    }

    await SafetyService.unbanUserFromCampaign(campaignId, params.userId)
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('Unban member error:', error)
    return NextResponse.json({ error: 'Failed to unban member' }, { status: 500 })
  }
}
