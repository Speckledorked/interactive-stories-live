// src/lib/notifications/notification-service.ts

import { prisma } from '@/lib/prisma';
import { NotificationType, NotificationPriority, NotificationStatus } from '@prisma/client';
import { sendEmail } from './email-service';
import { triggerPushNotification } from './push-service';
import { triggerSoundNotification } from '../realtime/pusher-server';

interface CreateNotificationParams {
  type: NotificationType;
  title: string;
  message: string;
  userId: string;
  campaignId?: string;
  sceneId?: string;
  priority?: NotificationPriority;
  actionUrl?: string;
  metadata?: any;
  triggerSound?: string;
  expiresAt?: Date;
}

interface NotificationPreferences {
  emailEnabled: boolean;
  pushEnabled: boolean;
  soundEnabled: boolean;
  quietHours?: {
    enabled: boolean;
    start: string;
    end: string;
    timezone: string;
  };
}

export class NotificationService {

  // Create and send notification
  static async createNotification(params: CreateNotificationParams) {
    const {
      type,
      title,
      message,
      userId,
      campaignId,
      sceneId,
      priority = 'NORMAL',
      actionUrl,
      metadata,
      triggerSound,
      expiresAt
    } = params;

    // Get user preferences
    const preferences = await this.getUserPreferences(userId);

    // Check quiet hours
    if (this.isQuietHours(preferences.quietHours)) {
      // During quiet hours, only send URGENT notifications
      if (priority !== 'URGENT') {
        return this.createSilentNotification(params);
      }
    }

    // Create notification in database
    const notification = await prisma.notification.create({
      data: {
        type,
        title,
        message,
        priority,
        userId,
        campaignId,
        sceneId,
        actionUrl,
        metadata,
        expiresAt,
      },
      include: {
        user: {
          select: { email: true, name: true }
        },
        campaign: {
          select: { title: true }
        }
      }
    });

    // Send via different channels based on preferences
    await Promise.all([
      this.sendEmailNotification(notification, preferences),
      this.sendPushNotification(notification, preferences),
      this.sendSoundNotification(notification, preferences, triggerSound),
      this.sendRealtimeNotification(notification)
    ]);

    return notification;
  }

  // Create notification without sending (for quiet hours)
  private static async createSilentNotification(params: CreateNotificationParams) {
    return await prisma.notification.create({
      data: {
        type: params.type,
        title: params.title,
        message: params.message,
        priority: params.priority || 'NORMAL',
        userId: params.userId,
        campaignId: params.campaignId,
        sceneId: params.sceneId,
        actionUrl: params.actionUrl,
        metadata: params.metadata,
        expiresAt: params.expiresAt,
      }
    });
  }

  // Get user notification preferences
  private static async getUserPreferences(userId: string): Promise<NotificationPreferences> {
    const settings = await prisma.userNotificationSettings.findUnique({
      where: { userId }
    });

    if (!settings) {
      // Create default settings
      await prisma.userNotificationSettings.create({
        data: { userId }
      });

      return {
        emailEnabled: true,
        pushEnabled: true,
        soundEnabled: true,
      };
    }

    return {
      emailEnabled: settings.emailEnabled,
      pushEnabled: settings.pushEnabled,
      soundEnabled: settings.soundEnabled,
      quietHours: settings.quietHoursEnabled ? {
        enabled: true,
        start: settings.quietHoursStart || '22:00',
        end: settings.quietHoursEnd || '08:00',
        timezone: settings.timezone || 'UTC'
      } : undefined
    };
  }

  // Check if current time is in quiet hours
  private static isQuietHours(quietHours?: NotificationPreferences['quietHours']): boolean {
    if (!quietHours?.enabled) return false;

    const now = new Date();
    const currentTime = now.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      timeZone: quietHours.timezone
    });

    const start = quietHours.start;
    const end = quietHours.end;

    // Handle overnight quiet hours (e.g., 22:00 to 08:00)
    if (start > end) {
      return currentTime >= start || currentTime <= end;
    }

    return currentTime >= start && currentTime <= end;
  }

  // Send email notification
  private static async sendEmailNotification(notification: any, preferences: NotificationPreferences) {
    if (!preferences.emailEnabled) return;

    const settings = await prisma.userNotificationSettings.findUnique({
      where: { userId: notification.userId }
    });

    if (!settings) return;

    // Check type-specific email preferences
    const emailAllowed = this.isEmailAllowedForType(notification.type, settings);
    if (!emailAllowed) return;

    try {
      await sendEmail({
        to: notification.user.email,
        subject: notification.title,
        html: this.buildEmailContent(notification),
        notificationId: notification.id
      });

      await prisma.notification.update({
        where: { id: notification.id },
        data: { emailSent: true }
      });
    } catch (error) {
      console.error('Failed to send email notification:', error);
    }
  }

  // Check if email is allowed for notification type
  private static isEmailAllowedForType(type: NotificationType, settings: any): boolean {
    switch (type) {
      case 'TURN_REMINDER':
        return settings.emailTurnReminders;
      case 'SCENE_CHANGE':
        return settings.emailSceneChanges;
      case 'MENTION':
        return settings.emailMentions;
      case 'WHISPER_RECEIVED':
        return settings.emailWhispers;
      case 'CAMPAIGN_INVITE':
        return settings.emailCampaignInvites;
      case 'WORLD_EVENT':
        return settings.emailWorldEvents;
      default:
        return true;
    }
  }

  // Send push notification
  private static async sendPushNotification(notification: any, preferences: NotificationPreferences) {
    if (!preferences.pushEnabled) return;

    try {
      await triggerPushNotification({
        userId: notification.userId,
        title: notification.title,
        message: notification.message,
        actionUrl: notification.actionUrl,
        data: notification.metadata
      });

      await prisma.notification.update({
        where: { id: notification.id },
        data: { pushSent: true }
      });
    } catch (error) {
      console.error('Failed to send push notification:', error);
    }
  }

  // Send sound notification
  private static async sendSoundNotification(
    notification: any,
    preferences: NotificationPreferences,
    triggerSound?: string
  ) {
    if (!preferences.soundEnabled || !triggerSound) return;

    try {
      await triggerSoundNotification(
        notification.userId,
        notification.campaignId || 'global',
        {
          sound: triggerSound,
          volume: 1.0,
          notification: {
            id: notification.id,
            type: notification.type,
            title: notification.title
          }
        }
      );
    } catch (error) {
      console.error('Failed to send sound notification:', error);
    }
  }

  // Send real-time notification
  private static async sendRealtimeNotification(notification: any) {
    const { triggerNotificationUpdate } = await import('../realtime/pusher-server');

    try {
      await triggerNotificationUpdate(notification.userId, {
        id: notification.id,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        priority: notification.priority,
        actionUrl: notification.actionUrl,
        createdAt: notification.createdAt,
        campaignId: notification.campaignId,
        sceneId: notification.sceneId
      });
    } catch (error) {
      console.error('Failed to send realtime notification:', error);
    }
  }

  // Build email content
  private static buildEmailContent(notification: any): string {
    const campaignName = notification.campaign?.title || 'Your Campaign';

    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2563eb;">${notification.title}</h2>
        <p style="font-size: 16px; line-height: 1.6;">${notification.message}</p>

        ${notification.campaign ? `<p><strong>Campaign:</strong> ${campaignName}</p>` : ''}

        ${notification.actionUrl ? `
          <div style="margin: 20px 0;">
            <a href="${notification.actionUrl}"
               style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
              View in Game
            </a>
          </div>
        ` : ''}

        <hr style="margin: 20px 0; border: none; border-top: 1px solid #e5e7eb;">
        <p style="font-size: 12px; color: #6b7280;">
          This notification was sent from your AI Game Master application.
          <a href="/settings/notifications">Update notification preferences</a>
        </p>
      </div>
    `;
  }

  // Mark notification as read
  static async markAsRead(notificationId: string, userId: string) {
    return await prisma.notification.updateMany({
      where: {
        id: notificationId,
        userId: userId
      },
      data: {
        status: 'READ',
        readAt: new Date()
      }
    });
  }

  // Mark notification as dismissed
  static async dismiss(notificationId: string, userId: string) {
    return await prisma.notification.updateMany({
      where: {
        id: notificationId,
        userId: userId
      },
      data: {
        status: 'DISMISSED',
        dismissedAt: new Date()
      }
    });
  }

  // Get notifications for user
  static async getNotifications(userId: string, options?: {
    status?: NotificationStatus;
    campaignId?: string;
    limit?: number;
    offset?: number;
  }) {
    const { status, campaignId, limit = 20, offset = 0 } = options || {};

    const where: any = {
      userId,
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } }
      ]
    };

    if (status) {
      where.status = status;
    }

    if (campaignId) {
      where.campaignId = campaignId;
    }

    return await prisma.notification.findMany({
      where,
      include: {
        campaign: {
          select: { id: true, title: true }
        },
        scene: {
          select: { id: true, sceneIntroText: true }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset
    });
  }

  // Clean up expired notifications
  static async cleanupExpiredNotifications() {
    return await prisma.notification.deleteMany({
      where: {
        expiresAt: {
          lte: new Date()
        }
      }
    });
  }

  // Get notification count
  static async getUnreadCount(userId: string, campaignId?: string) {
    const where: any = {
      userId,
      status: 'UNREAD',
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } }
      ]
    };

    if (campaignId) {
      where.campaignId = campaignId;
    }

    return await prisma.notification.count({ where });
  }
}

export default NotificationService;
