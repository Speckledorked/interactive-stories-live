// src/lib/pusher.ts
import Pusher from 'pusher'
import PusherClient from 'pusher-js'

// Server-side Pusher instance
// Provide defaults for build time when env vars may not be set
export const pusherServer = new Pusher({
  appId: process.env.PUSHER_APP_ID || 'build-placeholder',
  key: process.env.NEXT_PUBLIC_PUSHER_KEY || 'build-placeholder',
  secret: process.env.PUSHER_SECRET || 'build-placeholder',
  cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER || 'us2',
  useTLS: true,
})

// Client-side Pusher instance
export const pusherClient = new PusherClient(
  process.env.NEXT_PUBLIC_PUSHER_KEY || 'build-placeholder',
  {
    cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER || 'us2',
  }
)