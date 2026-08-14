// src/app/api/friends/requests/[requestId]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { notificationService } from '@/lib/notifications/notification-service'

// PATCH /api/friends/requests/[requestId] - Accept or reject a friend request
export async function PATCH(
  request: NextRequest,
  { params }: { params: { requestId: string } }
) {
  try {
    const user = await getUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = user.userId
    const { requestId } = params
    const body = await request.json()
    const { action } = body // 'accept' or 'reject'

    if (!['accept', 'reject'].includes(action)) {
      return NextResponse.json(
        { error: 'Invalid action. Must be "accept" or "reject"' },
        { status: 400 }
      )
    }

    // Get the friend request
    const friendRequest = await prisma.friendRequest.findUnique({
      where: { id: requestId },
    })

    if (!friendRequest) {
      return NextResponse.json(
        { error: 'Friend request not found' },
        { status: 404 }
      )
    }

    // Only the receiver can accept/reject
    if (friendRequest.receiverId !== userId) {
      return NextResponse.json(
        { error: 'You can only respond to requests sent to you' },
        { status: 403 }
      )
    }

    // Check if already responded
    if (friendRequest.status !== 'PENDING') {
      return NextResponse.json(
        { error: 'This request has already been responded to' },
        { status: 400 }
      )
    }

    if (action === 'accept') {
      // Create friendship and update request in a transaction
      const [friendship] = await prisma.$transaction([
        // Create friendship (user1Id is always the lower ID alphabetically)
        prisma.friendship.create({
          data: {
            user1Id:
              friendRequest.senderId < friendRequest.receiverId
                ? friendRequest.senderId
                : friendRequest.receiverId,
            user2Id:
              friendRequest.senderId < friendRequest.receiverId
                ? friendRequest.receiverId
                : friendRequest.senderId,
          },
        }),
        // Update request status
        prisma.friendRequest.update({
          where: { id: requestId },
          data: {
            status: 'ACCEPTED',
            respondedAt: new Date(),
          },
        }),
        // #315: the two directions of a friend request use different
        // unique keys ((senderId,receiverId) and (receiverId,senderId)),
        // so the DB constraint doesn't stop both A→B and B→A from ending
        // up PENDING at once (a genuine race between two near-simultaneous
        // POSTs). Left uncleaned, that reciprocal row would sit PENDING
        // forever and a later accept attempt on it would try to create a
        // second Friendship for the same pair, hitting Friendship's own
        // @@unique([user1Id, user2Id]) and failing this whole transaction
        // with a 500. Deleting it here — same transaction, so it can't
        // itself race the accept — closes that off regardless of whether
        // the initial double-PENDING race actually happened.
        prisma.friendRequest.deleteMany({
          where: {
            senderId: friendRequest.receiverId,
            receiverId: friendRequest.senderId,
            status: 'PENDING',
          },
        }),
      ])

      // Send notification to sender
      const receiver = await prisma.user.findUnique({
        where: { id: userId },
        select: { name: true, email: true },
      })

      await notificationService.sendFriendRequestAccepted(
        friendRequest.senderId,
        userId,
        receiver?.name || receiver?.email || 'Someone'
      )

      return NextResponse.json({
        message: 'Friend request accepted',
        friendship,
      })
    } else {
      // Reject the request. Deleted, not left as a REJECTED row in place
      // (#307) — matching cancel's own convention just below in this file.
      // @@unique([senderId, receiverId]) is on the raw pair with no status
      // scoping, so a REJECTED row parked here would permanently block the
      // sender from ever sending this receiver another request: the
      // sender-side existing-PENDING check wouldn't see it, but a fresh
      // create would still collide with it and 500.
      await prisma.friendRequest.delete({
        where: { id: requestId },
      })

      return NextResponse.json({
        message: 'Friend request rejected',
      })
    }
  } catch (error) {
    console.error('Respond to friend request error:', error)
    return NextResponse.json(
      { error: 'Failed to respond to friend request' },
      { status: 500 }
    )
  }
}

// DELETE /api/friends/requests/[requestId] - Cancel a friend request (sender only)
export async function DELETE(
  request: NextRequest,
  { params }: { params: { requestId: string } }
) {
  try {
    const user = await getUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = user.userId
    const { requestId } = params

    // Get the friend request
    const friendRequest = await prisma.friendRequest.findUnique({
      where: { id: requestId },
    })

    if (!friendRequest) {
      return NextResponse.json(
        { error: 'Friend request not found' },
        { status: 404 }
      )
    }

    // Only the sender can cancel
    if (friendRequest.senderId !== userId) {
      return NextResponse.json(
        { error: 'You can only cancel requests you sent' },
        { status: 403 }
      )
    }

    // Can only cancel pending requests
    if (friendRequest.status !== 'PENDING') {
      return NextResponse.json(
        { error: 'Can only cancel pending requests' },
        { status: 400 }
      )
    }

    // Delete the request
    await prisma.friendRequest.delete({
      where: { id: requestId },
    })

    return NextResponse.json({
      message: 'Friend request cancelled',
    })
  } catch (error) {
    console.error('Cancel friend request error:', error)
    return NextResponse.json(
      { error: 'Failed to cancel friend request' },
      { status: 500 }
    )
  }
}
