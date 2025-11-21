// src/lib/realtime/pusher-server.ts (UPDATED WITH NOTIFICATIONS)

import Pusher from 'pusher';
import { RealtimeMessage, RealtimeNoteUpdate } from './pusher-client';

let pusherServer: Pusher | null = null;

function getPusherServer(): Pusher {
  if (!pusherServer) {
    pusherServer = new Pusher({
      appId: process.env.PUSHER_APP_ID!,
      key: process.env.PUSHER_KEY!,
      secret: process.env.PUSHER_SECRET!,
      cluster: process.env.PUSHER_CLUSTER!,
      useTLS: true,
    });
  }
  return pusherServer;
}

// Trigger new message to campaign channel
export async function triggerNewMessage(message: RealtimeMessage) {
  const pusher = getPusherServer();
  
  // Send to campaign channel (for public messages)
  if (!message.targetUserId) {
    await pusher.trigger(`campaign-${message.campaignId}`, 'new-message', message);
  }
  
  // Send to whisper recipient (for private messages)
  if (message.type === 'WHISPER' && message.targetUserId) {
    await pusher.trigger(`user-${message.targetUserId}`, 'new-whisper', message);
    // Also send to sender so they see their own whisper
    await pusher.trigger(`user-${message.authorId}`, 'new-whisper', message);
  }
}

// Trigger note updates to campaign channel
export async function triggerNoteUpdate(noteUpdate: RealtimeNoteUpdate) {
  const pusher = getPusherServer();
  
  // Only trigger for shared notes or GM notes
  if (noteUpdate.visibility === 'SHARED' || noteUpdate.visibility === 'GM') {
    await pusher.trigger(`campaign-${noteUpdate.campaignId}`, 'note-update', noteUpdate);
  }
}

// Trigger user typing indicator
export async function triggerUserTyping(campaignId: string, userId: string, userName: string, isTyping: boolean) {
  const pusher = getPusherServer();
  
  await pusher.trigger(`campaign-${campaignId}`, 'user-typing', {
    userId,
    userName,
    isTyping,
    timestamp: new Date().toISOString()
  });
}

// Trigger scene updates (for context in chat)
export async function triggerSceneUpdate(campaignId: string, sceneData: any) {
  const pusher = getPusherServer();
  
  await pusher.trigger(`campaign-${campaignId}`, 'scene-update', sceneData);
}

// ============================================
// NEW NOTIFICATION FUNCTIONS (Phase 9)
// ============================================

// Trigger notification update to user
export async function triggerNotificationUpdate(userId: string, notification: {
  id: string;
  type: string;
  title: string;
  message: string;
  priority: string;
  actionUrl?: string;
  createdAt: string;
  campaignId?: string;
  sceneId?: string;
}) {
  const pusher = getPusherServer();
  
  await pusher.trigger(`user-${userId}`, 'notification-received', {
    ...notification,
    timestamp: new Date().toISOString()
  });
}

// Trigger sound notification
export async function triggerSoundNotification(
  userId: string, 
  campaignId: string,
  soundData: {
    sound: string;
    volume: number;
    notification?: {
      id: string;
      type: string;
      title: string;
    };
  }
) {
  const pusher = getPusherServer();
  
  // Send to user channel
  await pusher.trigger(`user-${userId}`, 'sound-notification', soundData);
  
  // Also send to campaign channel if it's a dramatic moment
  if (soundData.sound.includes('critical') || soundData.sound.includes('victory')) {
    await pusher.trigger(`campaign-${campaignId}`, 'dramatic-sound', {
      sound: soundData.sound,
      volume: soundData.volume * 0.7, // Lower volume for others
      triggeredBy: userId
    });
  }
}

// Trigger turn update notifications
export async function triggerTurnUpdate(campaignId: string, turnData: {
  currentPlayer: {
    userId: string;
    name: string;
    characterId?: string;
  };
  turnIndex: number;
  totalPlayers: number;
  timeRemainingMs: number;
  turnStartedAt: Date;
  turnDeadline?: Date;
}) {
  const pusher = getPusherServer();
  
  await pusher.trigger(`campaign-${campaignId}`, 'turn-update', {
    ...turnData,
    timestamp: new Date().toISOString()
  });
}

// Trigger turn reminder to specific user
export async function triggerTurnReminder(userId: string, reminderData: {
  campaignId: string;
  sceneId?: string;
  timeRemaining: number;
  character: string;
  urgency: 'normal' | 'urgent' | 'final';
}) {
  const pusher = getPusherServer();
  
  await pusher.trigger(`user-${userId}`, 'turn-reminder', {
    ...reminderData,
    timestamp: new Date().toISOString()
  });
}

// Trigger push notification event
export async function triggerPushNotificationEvent(userId: string, payload: any) {
  const pusher = getPusherServer();
  
  await pusher.trigger(`user-${userId}`, 'push-notification', payload);
}

// Trigger user online status update
export async function triggerUserOnlineStatus(campaignId: string, userData: {
  userId: string;
  userName: string;
  isOnline: boolean;
  lastSeen?: Date;
}) {
  const pusher = getPusherServer();
  
  await pusher.trigger(`campaign-${campaignId}`, 'user-status-update', {
    ...userData,
    timestamp: new Date().toISOString()
  });
}

// Trigger waiting indicator update
export async function triggerWaitingIndicator(campaignId: string, waitingData: {
  sceneId: string;
  waitingOnUsers: string[]; // user IDs
  action: 'waiting' | 'resolved';
  context?: string; // "scene resolution", "player action", etc.
}) {
  const pusher = getPusherServer();
  
  await pusher.trigger(`campaign-${campaignId}`, 'waiting-indicator-update', {
    ...waitingData,
    timestamp: new Date().toISOString()
  });
}

// Trigger dramatic moment for all campaign members
export async function triggerDramaticMoment(campaignId: string, dramaticData: {
  type: 'critical-success' | 'critical-failure' | 'major-victory' | 'character-death' | 'plot-twist';
  character?: string;
  description: string;
  soundEffect?: string;
  visualEffect?: string;
  triggeredBy: string; // user ID who caused the moment
}) {
  const pusher = getPusherServer();
  
  await pusher.trigger(`campaign-${campaignId}`, 'dramatic-moment', {
    ...dramaticData,
    timestamp: new Date().toISOString()
  });
}

// Trigger AI response ready notification
export async function triggerAIResponseReady(campaignId: string, responseData: {
  sceneId: string;
  playersInvolved: string[]; // user IDs
  responseType: 'scene-resolution' | 'world-update' | 'character-response';
  preview?: string; // Short preview of the response
}) {
  const pusher = getPusherServer();
  
  // Notify all campaign members
  await pusher.trigger(`campaign-${campaignId}`, 'ai-response-ready', {
    ...responseData,
    timestamp: new Date().toISOString()
  });

  // Send individual notifications to involved players
  for (const userId of responseData.playersInvolved) {
    await pusher.trigger(`user-${userId}`, 'ai-response-for-you', {
      ...responseData,
      timestamp: new Date().toISOString()
    });
  }
}

// Trigger notification count update
export async function triggerNotificationCountUpdate(userId: string, counts: {
  total: number;
  unread: number;
  mentions: number;
  turnReminders: number;
}) {
  const pusher = getPusherServer();
  
  await pusher.trigger(`user-${userId}`, 'notification-count-update', {
    ...counts,
    timestamp: new Date().toISOString()
  });
}

// Trigger bulk notification for campaign members
export async function triggerCampaignNotification(
  campaignId: string, 
  notification: {
    type: string;
    title: string;
    message: string;
    actionUrl?: string;
    soundEffect?: string;
    excludeUsers?: string[]; // User IDs to exclude
  }
) {
  const pusher = getPusherServer();
  
  await pusher.trigger(`campaign-${campaignId}`, 'campaign-notification', {
    ...notification,
    timestamp: new Date().toISOString()
  });
}

// Trigger system-wide maintenance notification
export async function triggerSystemNotification(notification: {
  type: 'maintenance' | 'update' | 'announcement';
  title: string;
  message: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  actionUrl?: string;
  scheduledFor?: Date;
}) {
  const pusher = getPusherServer();
  
  // Send to global system channel
  await pusher.trigger('system', 'system-notification', {
    ...notification,
    timestamp: new Date().toISOString()
  });
}

// Trigger live activity indicator
export async function triggerLiveActivity(campaignId: string, activity: {
  type: 'dice-roll' | 'typing' | 'character-action' | 'scene-change';
  userId: string;
  userName: string;
  description: string;
  metadata?: any;
}) {
  const pusher = getPusherServer();
  
  await pusher.trigger(`campaign-${campaignId}`, 'live-activity', {
    ...activity,
    timestamp: new Date().toISOString()
  });
}

export default getPusherServer;
