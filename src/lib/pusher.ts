// src/lib/pusher.ts
import Pusher from 'pusher'
import PusherClient from 'pusher-js'

// Check if Pusher is properly configured
export function isPusherConfigured(): boolean {
  if (typeof window !== 'undefined') {
    // Client-side check
    return !!(process.env.NEXT_PUBLIC_PUSHER_KEY && process.env.NEXT_PUBLIC_PUSHER_CLUSTER)
  } else {
    // Server-side check
    return !!(
      process.env.PUSHER_APP_ID &&
      process.env.NEXT_PUBLIC_PUSHER_KEY &&
      process.env.PUSHER_SECRET &&
      process.env.NEXT_PUBLIC_PUSHER_CLUSTER
    )
  }
}

// Server-side Pusher instance
// Provide defaults for build time when env vars may not be set
export const pusherServer = new Pusher({
  appId: process.env.PUSHER_APP_ID || 'placeholder',
  key: process.env.NEXT_PUBLIC_PUSHER_KEY || 'placeholder',
  secret: process.env.PUSHER_SECRET || 'placeholder',
  cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER || 'us2',
  useTLS: true,
})

// Client-side Pusher instance - only create if configured
let pusherClientInstance: PusherClient | null = null

export function getPusherClient(): PusherClient | null {
  // Check if we're on the client side
  if (typeof window === 'undefined') {
    return null
  }

  // Return existing instance if already created
  if (pusherClientInstance) {
    return pusherClientInstance
  }

  // Check if Pusher is configured
  if (!isPusherConfigured()) {
    console.warn('Pusher is not configured. Real-time features will be disabled. Configure NEXT_PUBLIC_PUSHER_KEY and NEXT_PUBLIC_PUSHER_CLUSTER to enable real-time updates.')
    return null
  }

  // Create and cache the instance
  pusherClientInstance = new PusherClient(
    process.env.NEXT_PUBLIC_PUSHER_KEY!,
    {
      cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER!,
      forceTLS: true,
    }
  )

  return pusherClientInstance
}

// For backwards compatibility - but this will be null if not configured
export const pusherClient = getPusherClient()