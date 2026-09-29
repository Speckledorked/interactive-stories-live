// src/lib/realtime/pusher-server.ts

import Pusher from 'pusher';
import { RealtimeMessage, RealtimeNoteUpdate } from './pusher-client';
import { campaignChannel, userChannel } from './channels';

let pusherServer: Pusher | null = null;

// Reads the same NEXT_PUBLIC_-prefixed key/cluster vars the client-side
// Pusher instance (lib/pusher.ts's getPusherClient, lib/realtime/pusher-
// client.ts) needs anyway — those two MUST already be set for the client
// to work at all, so having the server read a second, differently-named
// pair (the old PUSHER_KEY/PUSHER_CLUSTER) meant a deploy could configure
// the client-visible vars, see subscriptions "work," and still have every
// server-side trigger() silently gate to null because the other pair was
// never set. One pair of env vars now controls both sides.
function isPusherConfigured(): boolean {
  return !!(
    process.env.PUSHER_APP_ID &&
    process.env.NEXT_PUBLIC_PUSHER_KEY &&
    process.env.PUSHER_SECRET &&
    process.env.NEXT_PUBLIC_PUSHER_CLUSTER
  );
}

function getPusherServer(): Pusher | null {
  if (!isPusherConfigured()) {
    console.warn('Pusher is not configured. Set PUSHER_APP_ID, NEXT_PUBLIC_PUSHER_KEY, PUSHER_SECRET, and NEXT_PUBLIC_PUSHER_CLUSTER environment variables to enable real-time features.');
    return null;
  }

  if (!pusherServer) {
    pusherServer = new Pusher({
      appId: process.env.PUSHER_APP_ID!,
      key: process.env.NEXT_PUBLIC_PUSHER_KEY!,
      secret: process.env.PUSHER_SECRET!,
      cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER!,
      useTLS: true,
    });
  }
  return pusherServer;
}

/**
 * Publish, and never throw (#502).
 *
 * Realtime is an enhancement on top of state that is already persisted:
 * every event below corresponds to a row the client can refetch. So a
 * Pusher outage must cost a live update, never the write that caused it —
 * a typing indicator that 500s, or a notification whose DB row exists but
 * whose creating request failed, are strictly worse outcomes than a quiet
 * refresh.
 *
 * Most call sites had already learned this the hard way and wrapped their
 * own try/catch, which is the tell: the same five lines repeated at a dozen
 * sites, with the ones that forgot indistinguishable from the ones that
 * decided. Putting it here makes "must not fail the caller" a property of
 * publishing rather than a habit each caller has to remember.
 */
async function publish(pusher: Pusher, channel: string, event: string, payload: unknown): Promise<void> {
  try {
    await pusher.trigger(channel, event, payload)
  } catch (error) {
    console.error(`Failed to publish ${event} to ${channel} (non-critical):`, error)
  }
}

// Trigger new message to campaign channel
export async function triggerNewMessage(message: RealtimeMessage) {
  const pusher = getPusherServer();
  if (!pusher) return; // Pusher not configured

  // Send to campaign channel (for public messages)
  if (!message.targetUserId) {
    await publish(pusher, campaignChannel(message.campaignId), 'new-message', message);
  }

  // Send to whisper recipient (for private messages)
  if (message.type === 'WHISPER' && message.targetUserId) {
    await publish(pusher, userChannel(message.targetUserId), 'new-whisper', message);
    // Also send to sender so they see their own whisper. A separate publish
    // rather than a second channel on the same call, so a failure delivering
    // to the recipient cannot also swallow the sender's own echo.
    await publish(pusher, userChannel(message.authorId), 'new-whisper', message);
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
    await publish(pusher, campaignChannel(noteUpdate.campaignId), 'note-update', noteUpdate);
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

  await publish(pusher, campaignChannel(campaignId), 'user-typing', {
    userId,
    userName,
    isTyping,
    timestamp: new Date().toISOString()
  });
}

// NOTE: there is deliberately no triggerSceneUpdate / 'scene-update' event.
// It had no publisher and no subscriber — an orphan of an older naming
// convention. Everything scene-related settled on `scene:verb`
// (scene:resolving, scene:resolved, scene:ended, scene:paused,
// scene:resumed), all of which are published from the code that actually
// performs the action. A second, differently-named channel for the same
// thing is how two half-wired notification paths appear.

// Trigger notification update (stub function for notifications)
export async function triggerNotificationUpdate(userId: string, notification: any) {
  const pusher = getPusherServer();
  if (!pusher) return; // Pusher not configured

  await publish(pusher, userChannel(userId), 'notification-received', {
    ...notification,
    timestamp: new Date().toISOString()
  });
}

// Export PusherServer as named export (alias for getPusherServer)
export const PusherServer = getPusherServer;

export default getPusherServer;
