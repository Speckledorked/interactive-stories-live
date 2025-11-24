// src/lib/realtime/pusher-client.ts

import Pusher from 'pusher-js';

let pusherInstance: Pusher | null = null;

export function isPusherConfigured(): boolean {
  return !!(process.env.NEXT_PUBLIC_PUSHER_KEY && process.env.NEXT_PUBLIC_PUSHER_CLUSTER);
}

export function getPusherClient(): Pusher | null {
  if (!pusherInstance) {
    const pusherKey = process.env.NEXT_PUBLIC_PUSHER_KEY;
    const pusherCluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER;

    if (!pusherKey || !pusherCluster) {
      console.warn('Pusher is not configured. Real-time features will be disabled. Configure NEXT_PUBLIC_PUSHER_KEY and NEXT_PUBLIC_PUSHER_CLUSTER to enable real-time updates.');
      return null;
    }

    pusherInstance = new Pusher(pusherKey, {
      cluster: pusherCluster,
      forceTLS: true,
    });
  }
  return pusherInstance;
}

export function subscribeToCampaignMessages(campaignId: string) {
  const pusher = getPusherClient();
  if (!pusher) return null;
  return pusher.subscribe(`campaign-${campaignId}`);
}

export function subscribeToUserWhispers(userId: string) {
  const pusher = getPusherClient();
  if (!pusher) return null;
  return pusher.subscribe(`user-${userId}`);
}

export function unsubscribeFromChannel(channelName: string) {
  const pusher = getPusherClient();
  if (!pusher) return;
  pusher.unsubscribe(channelName);
}

// Message event types for type safety
export interface RealtimeMessage {
  id: string;
  content: string;
  type: 'IN_CHARACTER' | 'OUT_OF_CHARACTER' | 'WHISPER' | 'SYSTEM';
  authorId: string;
  campaignId: string;
  sceneId?: string;
  targetUserId?: string;
  characterId?: string;
  createdAt: string;
  author: {
    id: string;
    email: string;
    name?: string;
  };
  targetUser?: {
    id: string;
    email: string;
    name?: string;
  };
  character?: {
    id: string;
    name: string;
  };
}

export interface RealtimeNoteUpdate {
  id: string;
  title: string;
  content: string;
  visibility: 'PRIVATE' | 'GM' | 'SHARED';
  authorId: string;
  campaignId: string;
  action: 'created' | 'updated' | 'deleted';
  author: {
    id: string;
    email: string;
    name?: string;
  };
}
