// src/app/api/friends/requests/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { notificationService } from '@/lib/notifications/notification-service'

// GET /api/friends/requests - Get incoming and outgoing friend requests
export async function GET(request: NextRequest) {
  try {
    const user = await getUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = user.userId
    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type') || 'all' // 'incoming', 'outgoing', 'all'

    let where: any = {}

    if (type === 'incoming') {
      where = { receiverId: userId, status: 'PENDING' }
    } else if (type === 'outgoing') {
      where = { senderId: userId, status: 'PENDING' }
    } else {
      where = {
        OR: [
          { receiverId: userId },
          { senderId: userId },
        ],
      }
    }

    const requests = await prisma.friendRequest.findMany({
      where,
      orderBy: {
        createdAt: 'desc',
      },
    })

    // Get user details for senders and receivers
    const userIds = [
      ...requests.map((r) => r.senderId),
      ...requests.map((r) => r.receiverId),
    ]
    const uniqueUserIds = [...new Set(userIds)]

    const users = await prisma.user.findMany({
      where: {
        id: {
          in: uniqueUserIds,
        },
      },
      select: {
        id: true,
        email: true,
        name: true,
        isOnline: true,
      },
    })

    const userMap = Object.fromEntries(users.map((u) => [u.id, u]))

    const enrichedRequests = requests.map((req) => ({
      ...req,
      sender: userMap[req.senderId],
      receiver: userMap[req.receiverId],
    }))

    return NextResponse.json({ requests: enrichedRequests })
  } catch (error) {
    console.error('Get friend requests error:', error)
    return NextResponse.json(
      { error: 'Failed to get friend requests' },
      { status: 500 }
    )
  }
}

// POST /api/friends/requests - Send a friend request
export async function POST(request: NextRequest) {
  try {
    const user = await getUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = user.userId
    const body = await request.json()
    const { receiverId, message } = body

    if (!receiverId) {
      return NextResponse.json(
        { error: 'Receiver ID is required' },
        { status: 400 }
      )
    }

    // Can't send request to yourself
    if (receiverId === userId) {
      return NextResponse.json(
        { error: 'Cannot send friend request to yourself' },
        { status: 400 }
      )
    }

    // Check if already friends
    const existingFriendship = await prisma.friendship.findFirst({
      where: {
        OR: [
          { user1Id: userId, user2Id: receiverId },
          { user1Id: receiverId, user2Id: userId },
        ],
      },
    })

    if (existingFriendship) {
      return NextResponse.json(
        { error: 'You are already friends with this user' },
        { status: 400 }
      )
    }

    // Check if request already exists
    const existingRequest = await prisma.friendRequest.findFirst({
      where: {
        OR: [
          { senderId: userId, receiverId, status: 'PENDING' },
          { senderId: receiverId, receiverId: userId, status: 'PENDING' },
        ],
      },
    })

    if (existingRequest) {
      return NextResponse.json(
        { error: 'Friend request already pending' },
        { status: 400 }
      )
    }

    // Create the request
    const friendRequest = await prisma.friendRequest.create({
      data: {
        senderId: userId,
        receiverId,
        message,
        status: 'PENDING',
      },
    })

    // Send notification to receiver
    const sender = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true },
    })

    await notificationService.sendFriendRequest(
      receiverId,
      userId,
      sender?.name || sender?.email || 'Someone'
    )

    return NextResponse.json({
      friendRequest,
      message: 'Friend request sent successfully'
    })
  } catch (error) {
    console.error('Send friend request error:', error)
    return NextResponse.json(
      { error: 'Failed to send friend request' },
      { status: 500 }
    )
  }
}
