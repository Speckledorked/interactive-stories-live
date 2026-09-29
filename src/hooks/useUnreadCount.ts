// src/hooks/useUnreadCount.ts
//
// The header's bell needs an unread count, and no new plumbing is needed
// to get one: NotificationPanel already fetches /api/notifications and
// already binds the `notification-count-update` Pusher event on the
// userChannel(userId) channel. The count just lived inside the panel, so it
// only existed while the panel was open — which is exactly when a badge
// is least useful.
//
// This is that same pair (one fetch on mount, then the same
// subscription) lifted somewhere the chrome can read it. It is
// deliberately best-effort: no Pusher, no token, or a failed request all
// leave the count at 0 and render no badge, which is the same
// degradation the panel itself already accepts.

'use client'

import { useCallback, useEffect, useState } from 'react'
import { getPusherClient } from '@/lib/realtime/pusher-client'
import { authenticatedFetch, isAuthenticated, getUser } from '@/lib/clientAuth'
import { userChannel } from '@/lib/realtime/channels'
import { useRealtimeReconnect } from './useRealtimeReconnect'

export function useUnreadCount(): number {
  const [count, setCount] = useState(0)

  // #502: the badge is driven entirely by Pusher events after the initial
  // read, and events published while disconnected are gone for good — so a
  // dropped connection froze the count at whatever it last heard, which is
  // indistinguishable from having no unread notifications. Re-read it when
  // the connection comes back.
  const refetch = useCallback(() => {
    if (!isAuthenticated()) return
    authenticatedFetch('/api/notifications?status=UNREAD&limit=100')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data?.notifications) return
        setCount(data.notifications.length)
      })
      .catch(() => {
        // No badge is a fine outcome; never surface this to the user.
      })
  }, [])

  useRealtimeReconnect(refetch)

  useEffect(() => {
    const user = getUser()
    if (!user?.id) return

    let cancelled = false

    // The access cookie travels on its own; authenticatedFetch retries
    // once after a refresh on 401.
    if (isAuthenticated()) {
      authenticatedFetch('/api/notifications?status=UNREAD&limit=100')
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (cancelled || !data?.notifications) return
          setCount(data.notifications.length)
        })
        .catch(() => {
          // No badge is a fine outcome; never surface this to the user.
        })
    }

    const pusher = getPusherClient()
    if (!pusher) {
      return () => {
        cancelled = true
      }
    }

    const channelName = userChannel(user.id)
    const channel = pusher.subscribe(channelName)

    const onCount = (counts: { unread?: number }) => {
      if (typeof counts?.unread === 'number') setCount(counts.unread)
    }
    const onReceived = (notification: { status?: string }) => {
      if (notification?.status === 'UNREAD') setCount((c) => c + 1)
    }

    channel.bind('notification-count-update', onCount)
    channel.bind('notification-received', onReceived)

    return () => {
      cancelled = true
      channel.unbind('notification-count-update', onCount)
      channel.unbind('notification-received', onReceived)
      // Deliberately NOT unsubscribing from the channel: NotificationPanel
      // subscribes to the same one, and unsubscribing here would tear it
      // out from under the panel whenever this hook's owner unmounts
      // first. Pusher refcounts binds, not subscribes.
    }
  }, [])

  return count
}
