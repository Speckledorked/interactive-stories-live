// src/app/api/campaigns/[id]/bans/route.ts
// GM-only: the list of banned users, for the admin Safety tab.

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { UserRole } from '@prisma/client'

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
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('List bans error:', error)
    return NextResponse.json({ error: 'Failed to load bans' }, { status: 500 })
  }
}
