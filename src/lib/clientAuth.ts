// src/lib/clientAuth.ts
// Client-side authentication utilities.
//
// Since the httpOnly-cookie migration, the client NEVER holds a token.
// The session lives in two httpOnly cookies (access: 15 minutes,
// refresh: 30 days, path-scoped to /api/auth) that the browser attaches
// to same-origin requests on its own. What remains in localStorage is
// explicitly NOT credentials:
//   - the user profile (id/email/name), for display,
//   - a signed-in flag, for the pre-paint auth CTA (see lib/authFlag.ts),
//   - the last-viewed campaign id, for nav links.
// Stealing localStorage now yields display data, not a session.

import { AuthResponse } from '@/types/api'

const USER_KEY = 'ai_gm_user'
const LAST_CAMPAIGN_KEY = 'ai_gm_last_campaign'
/** Non-credential "a session exists" hint. Mirrored by the pre-paint
 * script in lib/authFlag.ts, which duplicates the string rather than
 * importing it (importing would defeat the inlining). */
export const SIGNED_IN_KEY = 'ai_gm_signed_in'

export interface StoredUser {
  id: string
  email: string
  name?: string | null
}

/** How far before the access cookie's 15-minute expiry the client
 * refreshes proactively, so normal play never trips a 401. */
const PROACTIVE_REFRESH_MS = 13 * 60 * 1000

let refreshTimer: ReturnType<typeof setTimeout> | null = null
/** Single-flight: concurrent 401s must not fire concurrent rotations —
 * the second would present an already-consumed token and look like
 * theft (see src/lib/refreshToken.ts reuse handling). */
let inflightRefresh: Promise<boolean> | null = null

function clearScheduledRefresh() {
  if (refreshTimer) {
    clearTimeout(refreshTimer)
    refreshTimer = null
  }
}

function scheduleProactiveRefresh() {
  clearScheduledRefresh()
  if (typeof window === 'undefined') return
  refreshTimer = setTimeout(() => {
    refreshTimer = null
    // Best-effort: if it fails (offline, expired refresh token), the
    // next authenticatedFetch 401 will retry reactively.
    void refreshSession()
  }, PROACTIVE_REFRESH_MS)
}

/**
 * Persist the signed-in user profile and mark the session live.
 * Called after login, signup, and successful refresh — each of which
 * means a fresh access cookie was just set.
 */
export function setAuth(user: StoredUser) {
  if (typeof window !== 'undefined') {
    localStorage.setItem(USER_KEY, JSON.stringify(user))
    localStorage.setItem(SIGNED_IN_KEY, '1')
    scheduleProactiveRefresh()
  }
}

/**
 * Get the cached user profile (display only — never a credential).
 */
export function getUser(): StoredUser | null {
  if (typeof window !== 'undefined') {
    const userStr = localStorage.getItem(USER_KEY)
    if (userStr) {
      try {
        return JSON.parse(userStr)
      } catch {
        return null
      }
    }
  }
  return null
}

/**
 * Merge updates into the stored user object (e.g. after a profile edit),
 * so cached reads like getUser() reflect the change without a re-login.
 */
export function updateStoredUser(updates: Partial<StoredUser>) {
  if (typeof window !== 'undefined') {
    const current = getUser()
    if (current) {
      localStorage.setItem(USER_KEY, JSON.stringify({ ...current, ...updates }))
    }
  }
}

/**
 * Check if a session is believed live. Deliberately NOT a validity
 * check — same contract as the old token-presence check, and the same
 * reason the pre-paint script uses it: a wrong "yes" costs one
 * redirect, a synchronous validity check costs a round trip.
 */
export function isAuthenticated(): boolean {
  if (typeof window === 'undefined') return false
  return localStorage.getItem(SIGNED_IN_KEY) === '1' && getUser() !== null
}

/**
 * Forget everything client-side: profile, flags, pending refresh.
 */
export function clearAuth() {
  clearScheduledRefresh()
  inflightRefresh = null
  if (typeof window !== 'undefined') {
    localStorage.removeItem(USER_KEY)
    localStorage.removeItem(SIGNED_IN_KEY)
    localStorage.removeItem(LAST_CAMPAIGN_KEY)
  }
}

/**
 * Remember the campaign the user was last viewing, so pages without their
 * own campaign context (Settings, Help, Tutorial) can still link the bottom
 * nav's Map/Characters/Quests items back to it instead of going inert.
 */
export function setLastCampaignId(campaignId: string) {
  if (typeof window !== 'undefined') {
    localStorage.setItem(LAST_CAMPAIGN_KEY, campaignId)
  }
}

export function getLastCampaignId(): string | null {
  if (typeof window !== 'undefined') {
    return localStorage.getItem(LAST_CAMPAIGN_KEY)
  }
  return null
}

/**
 * Redeem the refresh cookie for a fresh session. Single-flight across
 * concurrent callers. Returns true when the session is live again.
 * Never throws — callers treat false as "re-login needed".
 */
export async function refreshSession(): Promise<boolean> {
  if (typeof window === 'undefined') return false
  if (!inflightRefresh) {
    inflightRefresh = (async () => {
      try {
        const response = await fetch('/api/auth/refresh', { method: 'POST' })
        if (!response.ok) return false
        const data = await response.json().catch(() => null)
        // The route sets fresh cookies; the body user keeps the local
        // profile in sync. setAuth also reschedules the proactive timer.
        if (data && data.user) setAuth(data.user)
        else scheduleProactiveRefresh()
        return true
      } catch {
        return false
      } finally {
        inflightRefresh = null
      }
    })()
  }
  return inflightRefresh
}

/**
 * Make an authenticated API request.
 *
 * No Authorization header: the httpOnly access cookie travels on its
 * own for same-origin requests. On a 401 (access cookie expired), one
 * refresh is attempted and the request retried once — callers see the
 * retry's response, so expired sessions are invisible to them. If the
 * refresh fails, the original 401 is returned and callers handle it
 * exactly as before (usually: redirect to /login).
 */
export async function authenticatedFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(options.headers)
  headers.set('Content-Type', 'application/json')

  const doFetch = (h: Headers) =>
    fetch(url, {
      ...options,
      headers: h,
    })

  let response = await doFetch(headers)

  // Never try to refresh the refresh endpoint itself — a 401 there means
  // the refresh token is dead, and retrying would just loop.
  if (response.status === 401 && !url.startsWith('/api/auth/refresh')) {
    const refreshed = await refreshSession()
    if (refreshed) {
      // Retry with the SAME normalized headers (the JSON content type
      // added above included) — rebuilding from options.headers here
      // used to drop it and turn retried POSTs into 400s.
      response = await doFetch(headers)
    }
  }

  return response
}

/**
 * Login helper. The session arrives as httpOnly cookies; the body
 * carries the user profile only.
 */
export async function login(email: string, password: string): Promise<AuthResponse> {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Login failed')
  }

  const data: AuthResponse = await response.json()
  setAuth(data.user)
  return data
}

/**
 * Signup helper. Same cookie contract as login.
 */
export async function signup(email: string, password: string): Promise<AuthResponse> {
  const response = await fetch('/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Signup failed')
  }

  const data: AuthResponse = await response.json()
  setAuth(data.user)
  return data
}

/**
 * Logout helper. Clears local state immediately, fires the server-side
 * revocation, then sends the user to /login.
 */
export function logout() {
  clearAuth()
  if (typeof window !== 'undefined') {
    // keepalive so the revocation survives the navigation below: without
    // it the browser can abort the POST mid-flight and the refresh token
    // stays valid server-side after the user thought they logged out.
    fetch('/api/auth/logout', { method: 'POST', keepalive: true }).catch(() => {})
    window.location.href = '/login'
  }
}
