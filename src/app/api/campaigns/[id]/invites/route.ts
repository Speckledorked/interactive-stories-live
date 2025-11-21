// src/app/api/campaigns/[id]/invites/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const campaignId = params.id
    const body = await request.json()

    // Check if user is admin
    const membership = await prisma.campaignMembership.findUnique({
      where: {
        userId_campaignId: {
          userId: user.userId,
          campaignId,
        },
      },
    })

    if (!membership || membership.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Only campaign admins can create invites' },
        { status: 403 }
      )
    }

    // Create invite with defaults
    const expiresAt = body.expiresAt 
      ? new Date(body.expiresAt) 
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days default

    const maxUses = body.maxUses ?? 10 // Default 10 uses

    const invite = await prisma.campaignInvite.create({
      data: {
        campaignId,
        createdBy: user.userId,
        expiresAt,
        maxUses,
      },
    })

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    const joinUrl = `${appUrl}/join/${invite.token}`

    return NextResponse.json({ 
      invite,
      joinUrl 
    })
  } catch (error) {
    console.error('Create invite error:', error)
    return NextResponse.json(
      { error: 'Failed to create invite' },
      { status: 500 }
    )
  }
}

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

    // Check if user is admin
    const membership = await prisma.campaignMembership.findUnique({
      where: {
        userId_campaignId: {
          userId: user.userId,
          campaignId,
        },
      },
    })

    if (!membership || membership.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Only campaign admins can view invites' },
        { status: 403 }
      )
    }

    // Get all invites
    const invites = await prisma.campaignInvite.findMany({
      where: { campaignId },
      include: {
        createdByUser: {
          select: {
            email: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    })

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

    const invitesWithUrls = invites.map((invite) => ({
      ...invite,
      joinUrl: `${appUrl}/join/${invite.token}`,
      isExpired: new Date() > invite.expiresAt,
      isExhausted: invite.maxUses > 0 && invite.uses >= invite.maxUses,
    }))

    return NextResponse.json({ invites: invitesWithUrls })
  } catch (error) {
    console.error('Get invites error:', error)
    return NextResponse.json(
      { error: 'Failed to get invites' },
      { status: 500 }
    )
  }
}
