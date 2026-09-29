// src/hooks/useRealtimeReconnect.ts
//
// Refetch when realtime comes back (#502).
//
// Pusher events are fire-and-forget: anything published while a client is
// disconnected is simply gone. So a dropped connection does not degrade a
// panel, it freezes one — chat, notifications and the unread badge all sit
// on whatever they last heard, with no error and no spinner, looking
// exactly like a quiet campaign. That is the worst shape a failure can
// take, because nothing prompts the person to reload.
//
// The story page already polls on a timer, which is right for the surface
// where a missed `scene:resolved` leaves someone staring at nothing. This
// is the cheap general version for everything else: the connection itself
// tells us when it broke and when it recovered, so a refetch on recovery
// costs one request per outage rather than one every few seconds forever.
//
// It cannot cover a connection that never recovers. That is a real residual
// gap, and a deliberate one — a permanent-outage polling tier for every
// panel is a bigger decision than a bug fix.

import { useEffect, useRef } from 'react'
import { getPusherClient } from '@/lib/realtime/pusher-client'

/**
 * Call `onReconnect` each time the realtime connection is re-established
 * after having been lost. Never fires for the initial connect — the caller
 * has just loaded its own data.
 */
export function useRealtimeReconnect(onReconnect: () => void) {
  // Held in a ref so a caller passing an inline arrow doesn't re-subscribe
  // on every render, which would tear down and rebuild the binding
  // constantly and could miss the very transition this exists to catch.
  const callback = useRef(onReconnect)
  callback.current = onReconnect

  useEffect(() => {
    const pusher = getPusherClient()
    if (!pusher) return

    let wasDisconnected = false

    const onStateChange = ({ current }: { previous: string; current: string }) => {
      if (current !== 'connected') {
        // 'connecting' covers the reconnect attempt itself, so the initial
        // connecting -> connected transition would otherwise look like a
        // recovery and fire a redundant refetch on mount.
        if (current === 'unavailable' || current === 'disconnected' || current === 'failed') {
          wasDisconnected = true
        }
        return
      }
      if (wasDisconnected) {
        wasDisconnected = false
        callback.current()
      }
    }

    pusher.connection.bind('state_change', onStateChange)
    return () => {
      pusher.connection.unbind('state_change', onStateChange)
    }
  }, [])
}
