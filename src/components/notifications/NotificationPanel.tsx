// src/components/notifications/NotificationPanel.tsx

'use client';

import { useState, useEffect, useRef } from 'react';
import { getPusherClient } from '@/lib/realtime/pusher-client';
import { getToken } from '@/lib/clientAuth';

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  status: 'UNREAD' | 'READ' | 'DISMISSED';
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  actionUrl?: string;
  createdAt: string;
  campaign?: {
    id: string;
    title: string;
  };
}

interface NotificationPanelProps {
  userId: string;
  campaignId?: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function NotificationPanel({ 
  userId, 
  campaignId, 
  isOpen, 
  onClose 
}: NotificationPanelProps) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [filter, setFilter] = useState<'all' | 'unread' | 'mentions' | 'turns'>('all');
  const [loading, setLoading] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  // Cached once per mount so every incoming notification doesn't re-fetch
  // the user's sound preference. Null means "not looked up yet".
  const soundPrefsRef = useRef<{ soundEnabled?: boolean } | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetchNotifications();
      setupRealtimeSubscription();
    }

    return () => {
      if (isOpen) {
        cleanup();
      }
    };
  }, [isOpen, filter, campaignId]);

  const fetchNotifications = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filter === 'unread') params.append('status', 'UNREAD');
      if (filter === 'mentions') params.append('type', 'MENTION');
      if (filter === 'turns') params.append('type', 'TURN_REMINDER');
      if (campaignId) params.append('campaignId', campaignId);
      params.append('limit', '50');

      const token = getToken();
      const response = await fetch(`/api/notifications?${params}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setNotifications(data.notifications);
        
        // Update unread count
        const unread = data.notifications.filter((n: Notification) => n.status === 'UNREAD').length;
        setUnreadCount(unread);
      }
    } catch (error) {
      console.error('Error fetching notifications:', error);
    } finally {
      setLoading(false);
    }
  };

  const setupRealtimeSubscription = () => {
    const pusher = getPusherClient();
    if (!pusher) {
      console.warn('Pusher is not configured. Real-time notification updates will be disabled.');
      return;
    }

    const channel = pusher.subscribe(`user-${userId}`);

    channel.bind('notification-received', (notification: any) => {
      setNotifications(prev => [notification, ...prev]);
      if (notification.status === 'UNREAD') {
        setUnreadCount(prev => prev + 1);
      }
      // Sound rides along with the realtime event rather than being a
      // separate server dispatch — the browser is the only place that can
      // actually make a noise, so sending a second message to ask it to
      // would be the round trip that made the old sound channel pointless.
      // Respects the user's own preference; failures are silent by design
      // (see SoundService).
      void playNotificationSound(notification.type);
    });

    channel.bind('notification-count-update', (counts: any) => {
      setUnreadCount(counts.unread);
    });
  };

  /**
   * Play this notification type's cue, if the user has sound on and the
   * type has one. Preferences are read fresh from the settings endpoint
   * and cached for the session — a stale toggle is a worse failure than
   * one extra request on first sound.
   */
  const playNotificationSound = async (notificationType: string) => {
    try {
      if (soundPrefsRef.current === null) {
        const token = getToken();
        const res = await fetch('/api/notifications/settings', {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        soundPrefsRef.current = res.ok ? await res.json() : { soundEnabled: false };
      }
      if (!soundPrefsRef.current?.soundEnabled) return;

      const { SoundService } = await import('@/lib/notifications/sound-service');
      await SoundService.playForNotificationType(notificationType, 0.4);
    } catch {
      // A notification that arrived but didn't chime is not worth
      // surfacing to the user.
    }
  };

  const cleanup = () => {
    const pusher = getPusherClient();
    if (!pusher) return;
    pusher.unsubscribe(`user-${userId}`);
  };

  const markAsRead = async (notificationId: string) => {
    try {
      const token = getToken();
      await fetch(`/api/notifications/${notificationId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ action: 'read' }),
      });

      // Update local state
      setNotifications(prev => 
        prev.map(n => 
          n.id === notificationId 
            ? { ...n, status: 'READ' as const }
            : n
        )
      );
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (error) {
      console.error('Error marking notification as read:', error);
    }
  };

  const dismissNotification = async (notificationId: string) => {
    try {
      const token = getToken();
      await fetch(`/api/notifications/${notificationId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ action: 'dismiss' }),
      });

      // Remove from local state
      setNotifications(prev => prev.filter(n => n.id !== notificationId));
      const wasUnread = notifications.find(n => n.id === notificationId)?.status === 'UNREAD';
      if (wasUnread) {
        setUnreadCount(prev => Math.max(0, prev - 1));
      }
    } catch (error) {
      console.error('Error dismissing notification:', error);
    }
  };

  const handleNotificationClick = async (notification: Notification) => {
    if (notification.status === 'UNREAD') {
      await markAsRead(notification.id);
    }

    if (notification.actionUrl) {
      window.location.href = notification.actionUrl;
      onClose();
    }
  };

  const markAllAsRead = async () => {
    const unreadNotifications = notifications.filter(n => n.status === 'UNREAD');
    
    for (const notification of unreadNotifications) {
      await markAsRead(notification.id);
    }
  };

  const getNotificationIcon = (type: string) => {
    const icons: Record<string, string> = {
      'TURN_REMINDER': '⏰',
      'SCENE_CHANGE': '🎬',
      'MENTION': '💬',
      'WHISPER_RECEIVED': '🔒',
      'NOTE_SHARED': '📝',
      'CAMPAIGN_INVITE': '🎲',
      'SCENE_RESOLVED': '✅',
      'AI_RESPONSE_READY': '🤖',
      'WORLD_EVENT': '🌍',
      'FRIEND_REQUEST': '👋',
      'SAFETY_ALERT': '✋',
      'CAMPAIGN_MILESTONE': '🏆'
    };
    return icons[type] || '📢';
  };

  const getPriorityColor = (priority: string) => {
    const colors: Record<string, string> = {
      'LOW': 'text-myth-ink-faint',
      'NORMAL': 'text-myth-ink-faint',
      'HIGH': 'text-myth-ink-muted',
      'URGENT': 'text-myth-danger'
    };
    return colors[priority] || 'text-myth-ink-faint';
  };

  const getRelativeTime = (timestamp: string) => {
    const now = new Date();
    const time = new Date(timestamp);
    const diffMs = now.getTime() - time.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return time.toLocaleDateString();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      <div className="absolute inset-0 bg-myth-surface-sunken backdrop-blur-sm" onClick={onClose} />

      <div className="absolute right-0 top-0 h-full w-full max-w-[85vw] sm:max-w-md bg-myth-surface-raised shadow-2xl shadow-black/50 border-l border-myth-border">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-myth-border bg-gradient-to-r from-myth-accent/15 to-transparent">
          <div>
            <h2 className="text-lg font-semibold text-myth-ink">Notifications</h2>
            {unreadCount > 0 && (
              <span className="text-sm text-myth-ink-faint">{unreadCount} unread</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="text-sm text-myth-ink-muted hover:text-myth-ink transition-colors"
              >
                Mark all read
              </button>
            )}
            <button
              onClick={onClose}
              className="text-myth-ink-faint hover:text-myth-ink transition-colors text-xl"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="flex border-b border-myth-border bg-myth-surface-sunken">
          {[
            { key: 'all', label: 'All' },
            { key: 'unread', label: 'Unread' },
            { key: 'mentions', label: 'Mentions' },
            { key: 'turns', label: 'Turns' }
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key as any)}
              className={`flex-1 py-2 px-1 text-sm font-medium border-b-2 transition-colors ${
                filter === tab.key
                  ? 'border-myth-accent text-myth-ink bg-myth-surface-sunken'
                  : 'border-transparent text-myth-ink-muted hover:text-myth-ink-muted'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Notifications List */}
        <div className="flex-1 overflow-y-auto max-h-[calc(100vh-140px)]">
          {loading ? (
            <div className="flex items-center justify-center p-8">
              <div className="spinner h-8 w-8"></div>
            </div>
          ) : notifications.length === 0 ? (
            <div className="text-center p-8 text-myth-gold">
              <div className="text-4xl mb-2">📭</div>
              <p>No notifications</p>
            </div>
          ) : (
            <div className="divide-y divide-myth-border">
              {notifications.map((notification) => (
                <div
                  key={notification.id}
                  className={`p-4 hover:bg-white/5 cursor-pointer transition-colors ${
                    notification.status === 'UNREAD' ? 'bg-myth-surface-sunken border-l-2 border-myth-accent' : ''
                  }`}
                  onClick={() => handleNotificationClick(notification)}
                >
                  <div className="flex items-start gap-3">
                    <div className="text-xl">
                      {getNotificationIcon(notification.type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <h4 className={`text-sm font-medium ${
                          notification.status === 'UNREAD' ? 'text-myth-ink' : 'text-myth-ink'
                        }`}>
                          {notification.title}
                        </h4>
                        <div className="flex items-center gap-1">
                          <div className={`w-2 h-2 rounded-full ${getPriorityColor(notification.priority)}`} />
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              dismissNotification(notification.id);
                            }}
                            className="text-myth-ink-faint hover:text-myth-ink-muted text-xs transition-colors"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                      <p className="text-sm text-myth-ink-faint mt-1 line-clamp-2">
                        {notification.message}
                      </p>
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-xs text-myth-gold">
                          {getRelativeTime(notification.createdAt)}
                        </span>
                        {notification.campaign && (
                          <span className="text-xs text-myth-ink-faint bg-myth-surface-sunken px-2 py-1 rounded border border-myth-border">
                            {notification.campaign.title}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
