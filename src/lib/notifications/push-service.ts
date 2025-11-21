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

  // Register service worker for push notifications
  static getServiceWorkerRegistration(): string {
    return `
// sw.js - Service Worker for Push Notifications

self.addEventListener('push', function(event) {
  const data = event.data ? event.data.json() : {};
  
  const options = {
    body: data.body || 'You have a new notification',
    icon: data.icon || '/icons/notification-icon.png',
    badge: data.badge || '/icons/badge-icon.png',
    tag: data.tag || 'ai-gm-notification',
    data: data.data || {},
    actions: data.actions || [],
    requireInteraction: data.requireInteraction || false,
    silent: data.silent || false,
    timestamp: data.timestamp || Date.now(),
    vibrate: data.vibrate || [200, 100, 200],
    image: data.image,
    renotify: true
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'AI Game Master', options)
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  
  if (event.action === 'view' || !event.action) {
    // Open the app at the specified URL
    const url = event.notification.data.url || '/';
    
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true })
        .then(function(clientList) {
          // Check if app is already open
          for (let i = 0; i < clientList.length; i++) {
            const client = clientList[i];
            if (client.url.includes(new URL(url, self.location.origin).pathname)) {
              return client.focus();
            }
          }
          
          // Open new window
          if (clients.openWindow) {
            return clients.openWindow(url);
          }
        })
    );
  } else if (event.action === 'dismiss') {
    // Just close the notification (already handled above)
    console.log('Notification dismissed');
  }
});

self.addEventListener('notificationclose', function(event) {
  console.log('Notification closed:', event.notification.tag);
});

// Handle background sync for offline notifications
self.addEventListener('sync', function(event) {
  if (event.tag === 'background-sync-notifications') {
    event.waitUntil(
      // Fetch pending notifications when back online
      fetch('/api/notifications/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          lastSync: localStorage.getItem('lastNotificationSync') || 0
        })
      })
      .then(response => response.json())
      .then(data => {
        // Show any notifications that came while offline
        data.notifications.forEach(notification => {
          self.registration.showNotification(notification.title, {
            body: notification.message,
            icon: '/icons/notification-icon.png',
            data: notification.data
          });
        });
        
        localStorage.setItem('lastNotificationSync', Date.now());
      })
      .catch(err => console.log('Background sync failed:', err))
    );
  }
});
`;
  }

  // Client-side push notification setup
  static getClientSetup(): string {
    return `
// Client-side push notification setup
class NotificationManager {
  constructor() {
    this.isSupported = 'Notification' in window && 'serviceWorker' in navigator;
    this.permission = Notification.permission;
  }

  // Request notification permission
  async requestPermission() {
    if (!this.isSupported) {
      throw new Error('Notifications not supported');
    }

    if (this.permission === 'granted') {
      return true;
    }

    if (this.permission === 'denied') {
      throw new Error('Notifications denied by user');
    }

    const permission = await Notification.requestPermission();
    this.permission = permission;
    
    return permission === 'granted';
  }

  // Register service worker
  async registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
      throw new Error('Service Worker not supported');
    }

    try {
      const registration = await navigator.serviceWorker.register('/sw.js');
      console.log('Service Worker registered:', registration);
      return registration;
    } catch (error) {
      console.error('Service Worker registration failed:', error);
      throw error;
    }
  }

  // Show local notification
  showNotification(title, options = {}) {
    if (!this.isSupported || this.permission !== 'granted') {
      console.warn('Cannot show notification - no permission');
      return;
    }

    const notification = new Notification(title, {
      body: options.message || options.body || '',
      icon: options.icon || '/icons/notification-icon.png',
      badge: options.badge || '/icons/badge-icon.png',
      tag: options.tag || 'ai-gm-notification',
      data: options.data || {},
      requireInteraction: options.requireInteraction || false,
      silent: options.silent || false,
      timestamp: options.timestamp || Date.now(),
      vibrate: options.vibrate || [200, 100, 200],
      ...options
    });

    // Auto close after 10 seconds unless requireInteraction is true
    if (!options.requireInteraction) {
      setTimeout(() => notification.close(), 10000);
    }

    // Handle click
    notification.onclick = function(event) {
      event.preventDefault();
      notification.close();
      
      if (options.actionUrl) {
        window.open(options.actionUrl, '_blank');
      }
    };

    return notification;
  }

  // Get notification permission status
  getPermissionStatus() {
    return {
      isSupported: this.isSupported,
      permission: this.permission,
      canRequest: this.permission === 'default'
    };
  }

  // Subscribe to push notifications
  async subscribeToPush(userId) {
    const registration = await this.registerServiceWorker();
    
    // Check if already subscribed
    const existingSubscription = await registration.pushManager.getSubscription();
    if (existingSubscription) {
      return existingSubscription;
    }

    // Create new subscription
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: this.urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY)
    });

    // Send subscription to server
    await fetch('/api/notifications/subscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': \`Bearer \${localStorage.getItem('ai_gm_token')}\`
      },
      body: JSON.stringify({
        userId,
        subscription
      })
    });

    return subscription;
  }

  // Convert VAPID key
  urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
      .replace(/\-/g, '+')
      .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  // Unsubscribe from push notifications
  async unsubscribeFromPush(userId) {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return;

    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;

    await subscription.unsubscribe();

    // Notify server
    await fetch('/api/notifications/unsubscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': \`Bearer \${localStorage.getItem('ai_gm_token')}\`
      },
      body: JSON.stringify({ userId })
    });
  }
}

// Export for use in components
window.NotificationManager = NotificationManager;
`;
  }
}

export const triggerPushNotification = PushService.triggerPushNotification.bind(PushService);
export default PushService;
