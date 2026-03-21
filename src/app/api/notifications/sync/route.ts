// src/app/api/notifications/sync/route.ts
// POST /api/notifications/sync
// Called by the service worker background-sync handler to fetch any
// notifications that arrived while the client was offline.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyAuth } from '@/lib/auth'

export async function POST(request: NextRequest) {
  try {
    const user = await verifyAuth(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const lastSync = body.lastSync ? new Date(Number(body.lastSync)) : new Date(0)

    const notifications = await prisma.notification.findMany({
      where: {
        userId: user.userId,
        status: 'UNREAD',
        createdAt: { gt: lastSync }
      },
      orderBy: { createdAt: 'asc' },
      take: 50,
      select: {
        id: true,
        type: true,
        title: true,
        message: true,
        actionUrl: true,
        createdAt: true
      }
    })

    return NextResponse.json({ notifications })
  } catch (error) {
    console.error('Notification sync error:', error)
    return NextResponse.json({ error: 'Failed to sync notifications' }, { status: 500 })
  }
}
