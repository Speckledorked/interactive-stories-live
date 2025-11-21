// src/lib/realtime/pusher-server.ts

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

// Trigger sound notification (stub function for notifications)
export async function triggerSoundNotification(userId: string, campaignId: string, data: any) {
  const pusher = getPusherServer();

  await pusher.trigger(`user-${userId}`, 'sound-notification', {
    campaignId,
    ...data,
    timestamp: new Date().toISOString()
  });
}

// Trigger notification update (stub function for notifications)
export async function triggerNotificationUpdate(userId: string, notification: any) {
  const pusher = getPusherServer();

  await pusher.trigger(`user-${userId}`, 'notification-update', {
    ...notification,
    timestamp: new Date().toISOString()
  });
}

// Trigger push notification event (stub function for notifications)
export async function triggerPushNotificationEvent(userId: string, data: any) {
  const pusher = getPusherServer();

  await pusher.trigger(`user-${userId}`, 'push-notification', {
    ...data,
    timestamp: new Date().toISOString()
  });
}

// Export PusherServer as named export (alias for getPusherServer)
export const PusherServer = getPusherServer;

export default getPusherServer;
