// src/app/api/friends/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'

// GET /api/friends - Get user's friends list with online status
export async function GET(request: NextRequest) {
  try {
    const user = await getUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = user.userId

    // Get all friendships where user is involved
    const friendships = await prisma.friendship.findMany({
      where: {
        OR: [
          { user1Id: userId },
          { user2Id: userId },
        ],
      },
    })

    // Extract friend IDs
    const friendIds = friendships.map((f) =>
      f.user1Id === userId ? f.user2Id : f.user1Id
    )

    // Get friend details with online status
    const friends = await prisma.user.findMany({
      where: {
        id: {
          in: friendIds,
        },
      },
      select: {
        id: true,
        email: true,
        name: true,
        isOnline: true,
        lastSeenAt: true,
      },
    })

    return NextResponse.json({ friends })
  } catch (error) {
    console.error('Get friends error:', error)
    return NextResponse.json(
      { error: 'Failed to get friends' },
      { status: 500 }
    )
  }
}

// DELETE /api/friends?friendId=xxx - Remove a friend
export async function DELETE(request: NextRequest) {
  try {
    const user = await getUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const friendId = searchParams.get('friendId')

    if (!friendId) {
      return NextResponse.json(
        { error: 'Friend ID is required' },
        { status: 400 }
      )
    }

    const userId = user.userId

    // Delete friendship (works regardless of user1/user2 order)
    await prisma.friendship.deleteMany({
      where: {
        OR: [
          { user1Id: userId, user2Id: friendId },
          { user1Id: friendId, user2Id: userId },
        ],
      },
    })

    return NextResponse.json({ message: 'Friend removed successfully' })
  } catch (error) {
    console.error('Remove friend error:', error)
    return NextResponse.json(
      { error: 'Failed to remove friend' },
      { status: 500 }
    )
  }
}
