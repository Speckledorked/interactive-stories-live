// src/app/api/campaigns/[id]/invites/friends/route.ts
//
// #507 — the bridge between the friends system and play.
//
// MythOS had both halves and no join between them. The friends system
// could tell you who your friends were, show you whether they were online,
// and do nothing else with that; campaign invites were bearer tokens you
// had to paste into some other app to deliver. So the one audience most
// likely to accept — people who had already agreed to be your friend here
// — was reachable only by leaving.
//
// GET lists the caller's friends annotated for this campaign, so the
// picker can grey out the ones there is no point offering. POST issues an
// ADDRESSED invite (CampaignInvite.invitedUserId) and delivers it as a
// notification. The invite is still an ordinary invite — same token, same
// expiry, same join route, same ban check — it simply names who may redeem
// it, which is what makes delivering it in-app safe: a notification is not
// a private channel in the way a pasted link pretends to be, and anyone
// who saw a bearer token in one could use it.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { getAppUrl } from '@/lib/appUrl'
import { requireCampaignAdmin } from '@/lib/db/campaignAccess'
import { SafetyService } from '@/lib/safety/safety-service'
import { NotificationService } from '@/lib/notifications/notification-service'

/** How long an addressed invite stays good. Same default as a link invite. */
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** Every friendship row for `userId`, as the other party's id. */
async function friendIdsOf(userId: string): Promise<string[]> {
  const friendships = await prisma.friendship.findMany({
    where: { OR: [{ user1Id: userId }, { user2Id: userId }] },
    select: { user1Id: true, user2Id: true },
  })
  return friendships.map((f) => (f.user1Id === userId ? f.user2Id : f.user1Id))
}

// GET — the caller's friends, each annotated with why they can or cannot be
// invited to THIS campaign. Admin-only for the same reason POST is: the
// annotations disclose who is already a member.
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await getUser(request)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const campaignId = params.id
    const adminCheck = await requireCampaignAdmin(
      user.userId,
      campaignId,
      'Only campaign admins can invite friends'
    )
    if ('response' in adminCheck) return adminCheck.response

    const friendIds = await friendIdsOf(user.userId)
    if (friendIds.length === 0) return NextResponse.json({ friends: [] })

    const now = new Date()
    const [friends, memberships, pending, bans] = await Promise.all([
      prisma.user.findMany({
        where: { id: { in: friendIds } },
        select: { id: true, name: true, email: true, isOnline: true },
      }),
      prisma.campaignMembership.findMany({
        where: { campaignId, userId: { in: friendIds } },
        select: { userId: true },
      }),
      // Only invites still worth counting: an expired or spent one should
      // not stop you re-inviting someone who never got round to it.
      prisma.campaignInvite.findMany({
        where: {
          campaignId,
          invitedUserId: { in: friendIds },
          expiresAt: { gt: now },
          uses: 0,
        },
        select: { invitedUserId: true },
      }),
      prisma.campaignBan.findMany({
        where: { campaignId, userId: { in: friendIds } },
        select: { userId: true, isPermanent: true, expiresAt: true },
      }),
    ])

    const memberIds = new Set(memberships.map((m) => m.userId))
    const invitedIds = new Set(pending.map((i) => i.invitedUserId))
    // An expired temporary ban is not a ban. Mirrors isUserBanned's own
    // rule; not calling it per friend because that lifts expired bans as a
    // side effect, which a read of a picker should not do.
    const bannedIds = new Set(
      bans.filter((b) => b.isPermanent || !b.expiresAt || b.expiresAt > now).map((b) => b.userId)
    )

    const annotated = friends
      .map((f) => ({
        id: f.id,
        name: f.name || f.email,
        isOnline: f.isOnline,
        isMember: memberIds.has(f.id),
        isInvited: invitedIds.has(f.id),
        isBanned: bannedIds.has(f.id),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))

    return NextResponse.json({ friends: annotated })
  } catch (error) {
    console.error('List invitable friends error:', error)
    return NextResponse.json({ error: 'Failed to list friends' }, { status: 500 })
  }
}

// POST { friendId } — issue an addressed invite and deliver it in-app.
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await getUser(request)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const campaignId = params.id
    const body = await request.json().catch(() => ({}))
    const friendId = typeof body?.friendId === 'string' ? body.friendId : null
    if (!friendId) {
      return NextResponse.json({ error: 'friendId is required' }, { status: 400 })
    }

    const adminCheck = await requireCampaignAdmin(
      user.userId,
      campaignId,
      'Only campaign admins can invite friends'
    )
    if ('response' in adminCheck) return adminCheck.response

    // Friendship is checked server-side, not inferred from the picker
    // having offered them: the picker is a convenience, and this route is
    // reachable without it. Without this, any admin could address an invite
    // to any user id and have MythOS deliver it — an unsolicited-invite
    // channel, which is exactly what the friends gate is for.
    const friendIds = await friendIdsOf(user.userId)
    if (!friendIds.includes(friendId)) {
      return NextResponse.json(
        { error: 'You can only invite people on your friends list' },
        { status: 403 }
      )
    }

    if (await SafetyService.isUserBanned(campaignId, friendId)) {
      return NextResponse.json(
        { error: 'That player is banned from this campaign' },
        { status: 403 }
      )
    }

    const [campaign, existingMembership] = await Promise.all([
      prisma.campaign.findUnique({ where: { id: campaignId }, select: { title: true } }),
      prisma.campaignMembership.findFirst({
        where: { campaignId, userId: friendId },
        select: { id: true },
      }),
    ])
    if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    if (existingMembership) {
      return NextResponse.json(
        { error: 'They are already in this campaign' },
        { status: 409 }
      )
    }

    // Reuse a live, unredeemed invite rather than stacking a second one:
    // inviting twice is a normal thing to do when the first went unanswered,
    // and it should not leave two valid tokens and two notifications.
    const existingInvite = await prisma.campaignInvite.findFirst({
      where: {
        campaignId,
        invitedUserId: friendId,
        expiresAt: { gt: new Date() },
        uses: 0,
      },
    })

    const invite =
      existingInvite ??
      (await prisma.campaignInvite.create({
        data: {
          campaignId,
          createdBy: user.userId,
          invitedUserId: friendId,
          expiresAt: new Date(Date.now() + INVITE_TTL_MS),
          // Addressed to one person, so one use. join/[token] enforces the
          // recipient as well; this makes the token worthless once spent
          // even if that check were ever relaxed.
          maxUses: 1,
        },
      }))

    const joinUrl = `${getAppUrl()}/join/${invite.token}`

    // Delivery is best-effort, deliberately AFTER the invite exists: a
    // failed notification leaves a redeemable invite the inviter can still
    // see and chase, where the reverse would promise an invite that was
    // never issued.
    try {
      const inviter = await prisma.user.findUnique({
        where: { id: user.userId },
        select: { name: true, email: true },
      })
      const inviterName = inviter?.name || inviter?.email || 'A friend'
      await NotificationService.createNotification({
        type: 'CAMPAIGN_INVITE',
        title: 'You have been invited to a campaign',
        message: `${inviterName} invited you to join ${campaign.title}`,
        userId: friendId,
        campaignId,
        actionUrl: `/join/${invite.token}`,
      })
    } catch (notifyError) {
      console.error('Failed to notify invited friend (non-critical):', notifyError)
    }

    return NextResponse.json({
      invite: { id: invite.id, token: invite.token, expiresAt: invite.expiresAt },
      joinUrl,
      reused: Boolean(existingInvite),
    })
  } catch (error) {
    console.error('Invite friend error:', error)
    return NextResponse.json({ error: 'Failed to invite friend' }, { status: 500 })
  }
}
