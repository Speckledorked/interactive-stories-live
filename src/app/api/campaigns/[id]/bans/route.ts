// src/app/api/campaigns/[id]/bans/route.ts
// GM-only: the list of banned users, for the admin Safety tab.

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { UserRole } from '@prisma/client'
import { getCampaignMembership } from '@/lib/db/campaignAccess'
import { handleRouteError } from '@/lib/api/errors'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await requireAuth(request)
    const campaignId = params.id

    const membership = await getCampaignMembership(user.userId, campaignId)
    if (!membership || membership.role !== UserRole.ADMIN) {
      return NextResponse.json({ error: 'Only admins can view bans' }, { status: 403 })
    }

    const bans = await prisma.campaignBan.findMany({
      where: { campaignId },
      orderBy: { createdAt: 'desc' },
    })

    const userIds = bans.map(b => b.userId)
    const users = userIds.length
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true },
        })
      : []
    const userById = new Map(users.map(u => [u.id, u]))

    return NextResponse.json({
      bans: bans.map(b => ({ ...b, user: userById.get(b.userId) || null })),
    })
  } catch (error) {
    return handleRouteError(error, 'List bans error', 'Failed to load bans')
  }
}
