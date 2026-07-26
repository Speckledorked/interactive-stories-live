// src/lib/realtime/pusher-server.ts

import Pusher from 'pusher';
import { RealtimeMessage, RealtimeNoteUpdate } from './pusher-client';

let pusherServer: Pusher | null = null;

function isPusherConfigured(): boolean {
  return !!(
    process.env.PUSHER_APP_ID &&
    process.env.PUSHER_KEY &&
    process.env.PUSHER_SECRET &&
    process.env.PUSHER_CLUSTER
  );
}

function getPusherServer(): Pusher | null {
  if (!isPusherConfigured()) {
    console.warn('Pusher is not configured. Set PUSHER_APP_ID, PUSHER_KEY, PUSHER_SECRET, and PUSHER_CLUSTER environment variables to enable real-time features.');
    return null;
  }

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
  if (!pusher) return; // Pusher not configured

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
//
// The visibility check is the security boundary, not a filter: this goes to
// the whole campaign channel, so a PRIVATE note must never be published
// here. A note leaving SHARED is announced by passing its OLD visibility
// with action 'deleted' — otherwise nothing would be broadcast and every
// other player's panel would keep showing a note they can no longer read.
export async function triggerNoteUpdate(noteUpdate: RealtimeNoteUpdate) {
  const pusher = getPusherServer();
  if (!pusher) return; // Pusher not configured

  // Only trigger for shared notes or GM notes
  if (noteUpdate.visibility === 'SHARED' || noteUpdate.visibility === 'GM') {
    await pusher.trigger(`campaign-${noteUpdate.campaignId}`, 'note-update', noteUpdate);
  }
}

/**
 * Fire-and-forget wrapper for note broadcasts.
 *
 * A note write must not fail because realtime is down or unconfigured —
 * same contract notifyNoteShared already follows on these routes. The
 * caller gets its 200 either way; the worst case is a player refreshing.
 */
export function broadcastNoteUpdate(noteUpdate: RealtimeNoteUpdate): void {
  triggerNoteUpdate(noteUpdate).catch(err =>
    console.error('Failed to broadcast note update:', err)
  );
}

// Trigger user typing indicator
export async function triggerUserTyping(campaignId: string, userId: string, userName: string, isTyping: boolean) {
  const pusher = getPusherServer();
  if (!pusher) return; // Pusher not configured

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
  if (!pusher) return; // Pusher not configured

  await pusher.trigger(`campaign-${campaignId}`, 'scene-update', sceneData);
}

// Trigger notification update (stub function for notifications)
export async function triggerNotificationUpdate(userId: string, notification: any) {
  const pusher = getPusherServer();
  if (!pusher) return; // Pusher not configured

  await pusher.trigger(`user-${userId}`, 'notification-received', {
    ...notification,
    timestamp: new Date().toISOString()
  });
}

// Export PusherServer as named export (alias for getPusherServer)
export const PusherServer = getPusherServer;

export default getPusherServer;
