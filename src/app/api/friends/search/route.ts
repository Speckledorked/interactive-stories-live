// src/app/api/friends/search/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'

// GET /api/friends/search?q=email - Search for users by email to add as friends
export async function GET(request: NextRequest) {
  try {
    const user = await getUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const query = searchParams.get('q')

    if (!query || query.length < 2) {
      return NextResponse.json(
        { error: 'Search query must be at least 2 characters' },
        { status: 400 }
      )
    }

    const userId = user.userId

    // Search for users by email or name
    const users = await prisma.user.findMany({
      where: {
        AND: [
          {
            id: {
              not: userId, // Exclude self
            },
          },
          {
            OR: [
              {
                email: {
                  contains: query,
                  mode: 'insensitive',
                },
              },
              {
                name: {
                  contains: query,
                  mode: 'insensitive',
                },
              },
            ],
          },
        ],
      },
      select: {
        id: true,
        email: true,
        name: true,
        isOnline: true,
      },
      take: 10, // Limit results
    })

    // For each user, check if already friends or request pending
    const userIds = users.map((u) => u.id)

    const friendships = await prisma.friendship.findMany({
      where: {
        OR: userIds.flatMap((uid) => [
          { user1Id: userId, user2Id: uid },
          { user1Id: uid, user2Id: userId },
        ]),
      },
    })

    const friendRequests = await prisma.friendRequest.findMany({
      where: {
        OR: userIds.flatMap((uid) => [
          { senderId: userId, receiverId: uid, status: 'PENDING' },
          { senderId: uid, receiverId: userId, status: 'PENDING' },
        ]),
      },
    })

    const friendIds = new Set(
      friendships.map((f) =>
        f.user1Id === userId ? f.user2Id : f.user1Id
      )
    )

    const requestMap = new Map()
    friendRequests.forEach((req) => {
      const otherId = req.senderId === userId ? req.receiverId : req.senderId
      requestMap.set(otherId, {
        id: req.id,
        type: req.senderId === userId ? 'outgoing' : 'incoming',
      })
    })

    const enrichedUsers = users.map((u) => ({
      ...u,
      isFriend: friendIds.has(u.id),
      friendRequest: requestMap.get(u.id) || null,
    }))

    return NextResponse.json({ users: enrichedUsers })
  } catch (error) {
    console.error('Search users error:', error)
    return NextResponse.json(
      { error: 'Failed to search users' },
      { status: 500 }
    )
  }
}
