// src/app/api/notifications/[id]/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { NotificationService } from '@/lib/notifications/notification-service';
import { verifyAuth } from '@/lib/auth';

// GET /api/notifications/[id] - Get specific notification
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await verifyAuth(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const notifications = await NotificationService.getNotifications(user.userId, {
      limit: 1,
      offset: 0
    });

    const notification = notifications.find(n => n.id === params.id);

    if (!notification) {
      return NextResponse.json({ error: 'Notification not found' }, { status: 404 });
    }

    return NextResponse.json(notification);

  } catch (error) {
    console.error('Error fetching notification:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PUT /api/notifications/[id] - Update notification (mark as read/dismissed)
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await verifyAuth(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { action } = body;

    if (!action || !['read', 'dismiss'].includes(action)) {
      return NextResponse.json({ error: 'Invalid action. Use "read" or "dismiss"' }, { status: 400 });
    }

    let result;
    if (action === 'read') {
      result = await NotificationService.markAsRead(params.id, user.userId);
    } else {
      result = await NotificationService.dismiss(params.id, user.userId);
    }

    if (result.count === 0) {
      return NextResponse.json({ error: 'Notification not found' }, { status: 404 });
    }

    return NextResponse.json({
      message: `Notification ${action === 'read' ? 'marked as read' : 'dismissed'}`
    });

  } catch (error) {
    console.error('Error updating notification:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/notifications/[id] - Delete notification
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await verifyAuth(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const deleted = await prisma.notification.deleteMany({
      where: {
        id: params.id,
        userId: user.userId
      }
    });

    if (deleted.count === 0) {
      return NextResponse.json({ error: 'Notification not found' }, { status: 404 });
    }

    return NextResponse.json({ message: 'Notification deleted' });

  } catch (error) {
    console.error('Error deleting notification:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
