// src/app/api/campaigns/[id]/block/route.ts
// Self-service, campaign-scoped blocking between two players — distinct
// from a GM ban: blocking doesn't remove anyone from the campaign, it just
// hides the blocked user's messages from the blocker (see the filter in
// messages/route.ts).

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { SafetyService } from '@/lib/safety/safety-service'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = requireAuth(request)
    const campaignId = params.id

    const membership = await prisma.campaignMembership.findUnique({
      where: { userId_campaignId: { userId: user.userId, campaignId } },
    })
    if (!membership) {
      return NextResponse.json({ error: 'Not a member of this campaign' }, { status: 403 })
    }

    const body = await request.json()
    const { blockedUserId, reason } = body

    if (!blockedUserId || typeof blockedUserId !== 'string') {
      return NextResponse.json({ error: 'blockedUserId is required' }, { status: 400 })
    }
    if (blockedUserId === user.userId) {
      return NextResponse.json({ error: 'You cannot block yourself' }, { status: 400 })
    }

    const block = await SafetyService.blockUser(
      user.userId,
      blockedUserId,
      campaignId,
      typeof reason === 'string' ? reason.slice(0, 500) : undefined
    )

    return NextResponse.json({ block })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    // Unique constraint on [userId, blockedUserId, campaignId] — already blocked.
    if ((error as any)?.code === 'P2002') {
      return NextResponse.json({ error: 'Already blocked' }, { status: 409 })
    }
    console.error('Block user error:', error)
    return NextResponse.json({ error: 'Failed to block user' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = requireAuth(request)
    const campaignId = params.id

    const { searchParams } = new URL(request.url)
    const blockedUserId = searchParams.get('blockedUserId')
    if (!blockedUserId) {
      return NextResponse.json({ error: 'blockedUserId is required' }, { status: 400 })
    }

    await SafetyService.unblockUser(user.userId, blockedUserId, campaignId)
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('Unblock user error:', error)
    return NextResponse.json({ error: 'Failed to unblock user' }, { status: 500 })
  }
}

// The current user's own campaign-scoped blocks, for rendering block
// state in the member list.
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
    if (!membership) {
      return NextResponse.json({ error: 'Not a member of this campaign' }, { status: 403 })
    }

    const blocks = await prisma.userBlock.findMany({
      where: { userId: user.userId, campaignId },
      select: { blockedUserId: true },
    })

    return NextResponse.json({ blockedUserIds: blocks.map(b => b.blockedUserId) })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('List blocks error:', error)
    return NextResponse.json({ error: 'Failed to load blocks' }, { status: 500 })
  }
}
