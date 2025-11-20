// src/app/api/join/[token]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'

export async function POST(
  request: NextRequest,
  { params }: { params: { token: string } }
) {
  try {
    const user = await getUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { token } = params

    // Find the invite
    const invite = await prisma.campaignInvite.findUnique({
      where: { token },
      include: {
        campaign: true,
      },
    })

    if (!invite) {
      return NextResponse.json(
        { error: 'Invalid invite link' },
        { status: 404 }
      )
    }

    // Check if expired
    if (new Date() > invite.expiresAt) {
      return NextResponse.json(
        { error: 'This invite link has expired' },
        { status: 400 }
      )
    }

    // Check if max uses reached
    if (invite.maxUses > 0 && invite.uses >= invite.maxUses) {
      return NextResponse.json(
        { error: 'This invite link has reached its maximum uses' },
        { status: 400 }
      )
    }

    // Check if already a member
    const existingMembership = await prisma.campaignMembership.findUnique({
      where: {
        userId_campaignId: {
          userId: user.userId,
          campaignId: invite.campaignId,
        },
      },
    })

    if (existingMembership) {
      return NextResponse.json(
        { 
          message: 'You are already a member of this campaign',
          campaignId: invite.campaignId 
        },
        { status: 200 }
      )
    }

    // Create membership and increment uses in a transaction
    const [membership] = await prisma.$transaction([
      prisma.campaignMembership.create({
        data: {
          userId: user.userId,
          campaignId: invite.campaignId,
          role: 'player',
        },
      }),
      prisma.campaignInvite.update({
        where: { id: invite.id },
        data: { uses: { increment: 1 } },
      }),
    ])

    return NextResponse.json({
      message: 'Successfully joined campaign',
      campaignId: invite.campaignId,
      campaign: invite.campaign,
    })
  } catch (error) {
    console.error('Join campaign error:', error)
    return NextResponse.json(
      { error: 'Failed to join campaign' },
      { status: 500 }
    )
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: { token: string } }
) {
  try {
    const { token } = params

    // Find the invite
    const invite = await prisma.campaignInvite.findUnique({
      where: { token },
      include: {
        campaign: {
          select: {
            id: true,
            title: true,
            description: true,
            universe: true,
          },
        },
      },
    })

    if (!invite) {
      return NextResponse.json(
        { error: 'Invalid invite link' },
        { status: 404 }
      )
    }

    // Check if expired or exhausted
    const isExpired = new Date() > invite.expiresAt
    const isExhausted = invite.maxUses > 0 && invite.uses >= invite.maxUses

    return NextResponse.json({
      campaign: invite.campaign,
      isExpired,
      isExhausted,
      canJoin: !isExpired && !isExhausted,
    })
  } catch (error) {
    console.error('Get invite error:', error)
    return NextResponse.json(
      { error: 'Failed to get invite details' },
      { status: 500 }
    )
  }
}
