// src/app/api/join/[token]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { SafetyService } from '@/lib/safety/safety-service'
import { NotificationService } from '@/lib/notifications/notification-service'
import { getCampaignMembership } from '@/lib/db/campaignAccess'

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

    // Check if max uses reached. Re-checked atomically at claim time below
    // — this is the early, friendly rejection, not the enforcement.
    if (invite.maxUses > 0 && invite.uses >= invite.maxUses) {
      return NextResponse.json(
        { error: 'This invite link has reached its maximum uses' },
        { status: 400 }
      )
    }

    // #507: an ADDRESSED invite (invitedUserId set) is redeemable only by
    // the person it names. Checked before the ban and membership paths so
    // the wrong recipient learns nothing about the campaign's roster from
    // which error they get back.
    if (invite.invitedUserId && invite.invitedUserId !== user.userId) {
      return NextResponse.json(
        { error: 'This invite was sent to someone else' },
        { status: 403 }
      )
    }

    // A GM-issued ban blocks rejoining via any invite link, expired or not.
    if (await SafetyService.isUserBanned(invite.campaignId, user.userId)) {
      return NextResponse.json(
        { error: 'You have been banned from this campaign' },
        { status: 403 }
      )
    }

    // Check if already a member
    const existingMembership = await getCampaignMembership(user.userId, invite.campaignId)

    if (existingMembership) {
      return NextResponse.json(
        { 
          message: 'You are already a member of this campaign',
          campaignId: invite.campaignId 
        },
        { status: 200 }
      )
    }

    // #507: claim the use ATOMICALLY, still inside ONE transaction.
    //
    // Two properties, and the route previously had only one of them. The
    // transaction is what keeps the pair honest: a membership created
    // without the use count moving is a permanently reusable invite, and a
    // use count moving without a membership is a burned invite that granted
    // nothing. The read-then-write was the missing half — two people
    // opening the same one-use link at the same moment both read uses: 0,
    // both pass the check above, and both join. Scoping the updateMany to
    // the `uses` value THIS request read means only one of them can match,
    // and the affected-row count says which.
    //
    // The interactive form rather than the array form because the claim's
    // outcome has to decide whether the membership is written at all, which
    // an array of independent operations cannot express.
    //
    // An unlimited invite (maxUses 0) has nothing to race over — the
    // counter is a statistic, not a gate — so it takes a plain increment
    // rather than serialising every join behind a compare-and-set.
    const claimedSeat = await prisma.$transaction(async (tx) => {
      if (invite.maxUses > 0) {
        const claimed = await tx.campaignInvite.updateMany({
          where: { id: invite.id, uses: invite.uses },
          data: { uses: { increment: 1 } },
        })
        if (claimed.count === 0) return false
      } else {
        await tx.campaignInvite.update({
          where: { id: invite.id },
          data: { uses: { increment: 1 } },
        })
      }

      await tx.campaignMembership.create({
        data: {
          userId: user.userId,
          campaignId: invite.campaignId,
          role: 'PLAYER',
        },
      })
      return true
    })

    if (!claimedSeat) {
      return NextResponse.json(
        { error: 'This invite link has reached its maximum uses' },
        { status: 400 }
      )
    }

    // The one place a real campaign-invite notification actually fires —
    // previously this type existed only as a hijacked stand-in for friend
    // requests (see notification-service.ts), so joining via an invite
    // link notified nobody at all.
    try {
      const [joiner, admins] = await Promise.all([
        prisma.user.findUnique({ where: { id: user.userId }, select: { name: true, email: true } }),
        prisma.campaignMembership.findMany({
          where: { campaignId: invite.campaignId, role: 'ADMIN' },
          select: { userId: true },
        }),
      ])
      const joinerName = joiner?.name || joiner?.email || 'A new player'
      await Promise.all(
        admins
          .filter(a => a.userId !== user.userId)
          .map(a =>
            NotificationService.createNotification({
              type: 'CAMPAIGN_INVITE',
              title: 'New Member Joined',
              message: `${joinerName} joined ${invite.campaign.title} via your invite link`,
              userId: a.userId,
              campaignId: invite.campaignId,
              actionUrl: `/campaigns/${invite.campaignId}?tab=members`,
            })
          )
      )
    } catch (notifyError) {
      console.error('Failed to notify admins of new member (non-critical):', notifyError)
    }

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
      // #507: the page needs to know an invite is addressed so a wrong
      // recipient is told plainly rather than being offered a Join button
      // that 403s. The recipient's identity is NOT returned — only that
      // one exists — since this route is unauthenticated.
      isAddressed: invite.invitedUserId !== null,
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
