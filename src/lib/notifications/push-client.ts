// src/lib/notifications/push-client.ts
//
// Browser side of Web Push (README #92) — the step whose absence made the
// previous push scaffolding unable to ever fire. Nothing anywhere called
// pushManager.subscribe(), so the service worker's push handler waited on
// an event that could not be produced.
//
// Flow: fetch the server's VAPID public key → ask the browser for
// permission → subscribe through the service worker → POST the resulting
// subscription so the server has an endpoint to send to.

import { getToken } from '@/lib/clientAuth'

/** Whether this browser can do Web Push at all (Safari &lt;16, most in-app browsers). */
export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

/**
 * The VAPID public key arrives base64url-encoded; PushManager wants raw
 * bytes. This conversion is required by the Web Push spec and is the usual
 * place a hand-rolled implementation goes wrong.
 */
function urlBase64ToUint8Array(base64String: string): BufferSource {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  // Backed by an explicit ArrayBuffer so the result is a BufferSource
  // applicationServerKey accepts (a plain Uint8Array can be backed by a
  // SharedArrayBuffer as far as the type system is concerned).
  const buffer = new ArrayBuffer(raw.length)
  const view = new Uint8Array(buffer)
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i)
  return view
}

function authHeaders(): HeadersInit {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` }
}

export type PushEnableResult =
  | { ok: true }
  | { ok: false; reason: 'unsupported' | 'unconfigured' | 'denied' | 'failed'; detail?: string }

/**
 * Turn push on for this browser. Idempotent — re-running reuses an
 * existing subscription rather than creating a second one, and re-POSTs it
 * so a server that lost the row recovers.
 *
 * Every failure is a named reason rather than a thrown error, because the
 * caller needs to tell the user which of these happened: an unconfigured
 * deployment, a browser that can't, or a permission they denied are three
 * very different things to show.
 */
export async function enablePush(): Promise<PushEnableResult> {
  if (!isPushSupported()) return { ok: false, reason: 'unsupported' }

  try {
    const keyRes = await fetch('/api/notifications/push', { headers: authHeaders() })
    if (!keyRes.ok) return { ok: false, reason: 'failed', detail: 'Could not reach the server' }

    const { configured, publicKey } = await keyRes.json()
    if (!configured || !publicKey) return { ok: false, reason: 'unconfigured' }

    const permission = await Notification.requestPermission()
    if (permission !== 'granted') return { ok: false, reason: 'denied' }

    const registration = await navigator.serviceWorker.ready

    // Reuse an existing subscription when there is one: calling subscribe()
    // twice with different keys throws, and re-POSTing repairs a server
    // that no longer has the row.
    const existing = await registration.pushManager.getSubscription()
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        // Required by every current browser: no silent/data-only pushes.
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      }))

    const saveRes = await fetch('/api/notifications/push', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(subscription.toJSON()),
    })
    if (!saveRes.ok) return { ok: false, reason: 'failed', detail: 'Could not save the subscription' }

    return { ok: true }
  } catch (error) {
    return { ok: false, reason: 'failed', detail: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Turn push off for this browser: unsubscribe locally and drop the row
 * server-side. The server delete runs even if the local unsubscribe fails,
 * so a browser that's already lost its subscription doesn't leave a row
 * behind that keeps receiving sends.
 */
export async function disablePush(): Promise<void> {
  if (!isPushSupported()) return

  try {
    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.getSubscription()
    if (!subscription) return

    const endpoint = subscription.endpoint
    await subscription.unsubscribe().catch(() => { /* fall through to the server delete */ })

    await fetch('/api/notifications/push', {
      method: 'DELETE',
      headers: authHeaders(),
      body: JSON.stringify({ endpoint }),
    })
  } catch {
    // Best effort — a failure here leaves push on, which the settings
    // toggle will reflect the next time it's read.
  }
}
