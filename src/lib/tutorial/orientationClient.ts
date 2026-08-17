// src/lib/tutorial/orientationClient.ts
//
// Client-side state for the orientation overlay.
//
// Two layers, and the split matters:
//
//   * The DATABASE (User.orientationSeenAt) is the durable record. It
//     follows the user to another device and to another browser, which a
//     localStorage flag cannot.
//
//   * localStorage is a per-device CACHE of that record, and exists for
//     one reason: without it, every page load would have to wait for
//     /api/user to come back before it knew whether to render the
//     overlay, and a returning user would get a flash of the intro on
//     every navigation. With it, the overwhelmingly common case (seen it
//     already) is answered synchronously and renders nothing.
//
// The cache is keyed by user id, so two accounts sharing a browser don't
// inherit each other's answer — which a single global key would do,
// silently skipping the intro for the second person to log in.
//
// The cache is only ever allowed to say "seen". It is never trusted to
// say "not seen": a missing key means "ask the server", not "show the
// overlay". That asymmetry is what stops a cleared cache from re-nagging
// someone who has genuinely already dismissed it.

const KEY_PREFIX = 'ai_gm_orientation_seen'

function keyFor(userId: string): string {
  return `${KEY_PREFIX}:${userId}`
}

/** True only if this device has a positive record for this user. */
export function hasSeenOrientationLocally(userId: string): boolean {
  if (typeof window === 'undefined' || !userId) return false
  try {
    return window.localStorage.getItem(keyFor(userId)) === '1'
  } catch {
    // Private-mode / disabled storage. Fall back to asking the server.
    return false
  }
}

export function markOrientationSeenLocally(userId: string): void {
  if (typeof window === 'undefined' || !userId) return
  try {
    window.localStorage.setItem(keyFor(userId), '1')
  } catch {
    // Storage unavailable — the server record still holds, this device
    // just pays a fetch on each load.
  }
}

/** Drops the cached answer so the next load re-asks the server. */
export function clearOrientationLocally(userId: string): void {
  if (typeof window === 'undefined' || !userId) return
  try {
    window.localStorage.removeItem(keyFor(userId))
  } catch {
    // Nothing to do — see above.
  }
}
