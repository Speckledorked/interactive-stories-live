// src/app/api/notifications/settings/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAuth } from '@/lib/auth';

// GET /api/notifications/settings - Get user notification preferences
export async function GET(request: NextRequest) {
  try {
    const user = await verifyAuth(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let settings = await prisma.userNotificationSettings.findUnique({
      where: { userId: user.userId }
    });

    // Create default settings if none exist
    if (!settings) {
      settings = await prisma.userNotificationSettings.create({
        data: { userId: user.userId }
      });
    }

    return NextResponse.json(settings);

  } catch (error) {
    console.error('Error fetching notification settings:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PUT /api/notifications/settings - Update user notification preferences
export async function PUT(request: NextRequest) {
  try {
    const user = await verifyAuth(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    
    // Validate settings
    const allowedFields = [
      'emailEnabled', 'emailTurnReminders', 'emailSceneChanges', 'emailMentions',
      'emailWhispers', 'emailCampaignInvites', 'emailWorldEvents',
      'pushEnabled', 'pushTurnReminders', 'pushSceneChanges', 'pushMentions',
      'pushWhispers', 'pushCampaignInvites',
      'soundEnabled', 'soundTurnReminders', 'soundSceneChanges', 'soundMentions',
      'soundWhispers', 'soundCriticalMoments', 'soundWorldEvents',
      'quietHoursEnabled', 'quietHoursStart', 'quietHoursEnd', 'timezone',
      'dailyDigestEnabled', 'weeklyDigestEnabled'
    ];

    const updateData: any = {};
    for (const field of allowedFields) {
      if (field in body) {
        updateData[field] = body[field];
      }
    }

    // Validate quiet hours format
    if ('quietHoursStart' in updateData && updateData.quietHoursStart) {
      const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
      if (!timeRegex.test(updateData.quietHoursStart)) {
        return NextResponse.json({ error: 'Invalid quiet hours start time format (HH:MM)' }, { status: 400 });
      }
    }

    if ('quietHoursEnd' in updateData && updateData.quietHoursEnd) {
      const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
      if (!timeRegex.test(updateData.quietHoursEnd)) {
        return NextResponse.json({ error: 'Invalid quiet hours end time format (HH:MM)' }, { status: 400 });
      }
    }

    // Update or create settings
    const settings = await prisma.userNotificationSettings.upsert({
      where: { userId: user.userId },
      update: updateData,
      create: {
        userId: user.userId,
        ...updateData
      }
    });

    return NextResponse.json(settings);

  } catch (error) {
    console.error('Error updating notification settings:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
