// src/app/api/notifications/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAuth } from '@/lib/auth';
import { NotificationService } from '@/lib/notifications/notification-service';

// GET /api/notifications - Get user's notifications
export async function GET(request: NextRequest) {
  try {
    const user = await verifyAuth(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const campaignId = searchParams.get('campaignId');
    const type = searchParams.get('type');
    const limit = parseInt(searchParams.get('limit') || '20');
    const offset = parseInt(searchParams.get('offset') || '0');

    const options: any = { limit, offset };
    if (status) options.status = status;
    if (campaignId) options.campaignId = campaignId;

    const notifications = await NotificationService.getNotifications(user.userId, options);

    // Filter by type if specified
    const filteredNotifications = type ?
      notifications.filter(n => n.type === type) :
      notifications;

    return NextResponse.json({
      notifications: filteredNotifications,
      hasMore: notifications.length === limit
    });

  } catch (error) {
    console.error('Error fetching notifications:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/notifications - Create test notification (dev only)
export async function POST(request: NextRequest) {
  try {
    const user = await verifyAuth(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only allow in development
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'Not allowed in production' }, { status: 403 });
    }

    const body = await request.json();
    const { type, title, message, campaignId, priority, triggerSound } = body;

    const notification = await NotificationService.createNotification({
      type: type || 'TURN_REMINDER',
      title: title || 'Test Notification',
      message: message || 'This is a test notification.',
      userId: user.userId,
      campaignId,
      priority: priority || 'NORMAL',
      triggerSound
    });

    return NextResponse.json(notification);

  } catch (error) {
    console.error('Error creating notification:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/notifications - Clear all notifications
export async function DELETE(request: NextRequest) {
  try {
    const user = await verifyAuth(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const campaignId = searchParams.get('campaignId');

    const where: any = {
      userId: user.userId,
      status: { in: ['READ', 'DISMISSED'] } // Only delete read/dismissed notifications
    };

    if (campaignId) {
      where.campaignId = campaignId;
    }

    const deleted = await prisma.notification.deleteMany({ where });

    return NextResponse.json({
      message: `Deleted ${deleted.count} notifications`
    });

  } catch (error) {
    console.error('Error deleting notifications:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
