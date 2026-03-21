// src/lib/notifications/push-service.ts

interface PushNotificationParams {
  userId: string;
  title: string;
  message: string;
  actionUrl?: string;
  data?: any;
  icon?: string;
  badge?: string;
  tag?: string;
}

export class PushService {
  
  // Send browser push notification via Pusher
  static async triggerPushNotification(params: PushNotificationParams) {
    const { triggerPushNotificationEvent } = await import('../realtime/pusher-server');
    
    const payload = {
      title: params.title,
      body: params.message,
      icon: params.icon || '/icons/notification-icon.png',
      badge: params.badge || '/icons/badge-icon.png',
      tag: params.tag || `notification-${Date.now()}`,
      data: {
        url: params.actionUrl || '/',
        ...params.data
      },
      actions: params.actionUrl ? [
        {
          action: 'view',
          title: 'View',
          icon: '/icons/view-icon.png'
        },
        {
          action: 'dismiss',
          title: 'Dismiss',
          icon: '/icons/dismiss-icon.png'
        }
      ] : [],
      requireInteraction: false,
      silent: false,
      timestamp: Date.now(),
      vibrate: [200, 100, 200]
    };

    await triggerPushNotificationEvent(params.userId, payload);
    return payload;
  }

}

export const triggerPushNotification = PushService.triggerPushNotification.bind(PushService);
export default PushService;
