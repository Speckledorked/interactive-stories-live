// src/components/tutorial/OrientationGate.tsx
//
// Decides whether to show the orientation, and remembers the answer.
//
// Mounted once in the root layout, so it covers every page rather than
// only the ones that happen to use TavernPage. It renders nothing at all
// for a signed-out visitor, which is what keeps it off /login and /signup
// without needing a route allowlist that would rot.
//
// WHY EXISTING USERS SEE THIS. User.orientationSeenAt is added nullable
// with no backfill, so every account that predates it reads as "never
// seen" and gets the overlay once on next load. That is the intent: the
// people most in need of being told what this is are the ones who have
// been using it without ever having been told.
//
// FAILURE POSTURE: silent. If the fetch fails, or storage is unavailable,
// or the PATCH that records the dismissal fails, nothing is shown and
// nothing blocks. An intro screen is not worth interrupting someone's
// session over, and an intro that reappears because a write failed is
// worse than one that was missed.

'use client'

import { useCallback, useEffect, useState } from 'react'
import { authenticatedFetch, getUser, isAuthenticated } from '@/lib/clientAuth'
import {
  hasSeenOrientationLocally,
  markOrientationSeenLocally,
} from '@/lib/tutorial/orientationClient'
import { OrientationOverlay } from './OrientationOverlay'

export function OrientationGate() {
  const [open, setOpen] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)

  useEffect(() => {
    if (!isAuthenticated()) return

    const user = getUser()
    if (!user?.id) return
    setUserId(user.id)

    // Fast path. The common case is "seen it", and answering that from
    // localStorage means no fetch and, more importantly, no window in
    // which the overlay could flash before the answer arrives.
    if (hasSeenOrientationLocally(user.id)) return

    let cancelled = false

    void (async () => {
      try {
        const response = await authenticatedFetch('/api/user')
        if (!response.ok || cancelled) return

        const data = await response.json()
        if (cancelled) return

        if (data?.user?.orientationSeenAt) {
          // Seen on some other device. Cache it so this one stops asking.
          markOrientationSeenLocally(user.id)
          return
        }

        setOpen(true)
      } catch {
        // Offline or the route is unhappy. Say nothing.
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const dismiss = useCallback(() => {
    // Close first. The user's dismissal is honoured immediately and is not
    // contingent on a round trip succeeding.
    setOpen(false)

    if (!userId) return
    markOrientationSeenLocally(userId)

    void authenticatedFetch('/api/user', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orientationSeenAt: true }),
    }).catch(() => {
      // The local cache already stops it reappearing on this device; the
      // durable record will be written the next time they dismiss it
      // somewhere else. Not worth surfacing an error for.
    })
  }, [userId])

  if (!open) return null

  return <OrientationOverlay open={open} onDismiss={dismiss} />
}
