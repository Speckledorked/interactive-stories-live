// src/lib/pusher.ts
// Client-side Pusher only. The server-side instance used to live here too
// (an ungated `pusherServer` singleton, constructed unconditionally with
// 'placeholder' credentials when unconfigured) — that meant a `.trigger()`
// call in an unconfigured or partially-configured deploy attempted a real
// network call with garbage credentials instead of gating cleanly, and
// could hang the request rather than failing fast. Server-side triggers
// now go through lib/realtime/pusher-server.ts's getPusherServer(), which
// returns null (no network call at all) when unconfigured, checked at
// every call site.
import PusherClient from 'pusher-js'

// Check if Pusher is properly configured (client-side only now — see the
// header comment above for why the server-side branch this used to have
// was removed rather than fixed in place).
export function isPusherConfigured(): boolean {
  return !!(process.env.NEXT_PUBLIC_PUSHER_KEY && process.env.NEXT_PUBLIC_PUSHER_CLUSTER)
}

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