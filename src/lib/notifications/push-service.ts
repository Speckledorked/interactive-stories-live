// src/lib/notifications/push-service.ts
//
// Real Web Push delivery (README #92).
//
// An earlier version of this file published a Pusher event named
// "push-notification" that no client ever listened for, while the service
// worker had a correct-looking `push` handler that could never fire — there
// was no subscription flow, no VAPID keys, and no push send anywhere. The
// two halves were each wired at one end and met nowhere. This is the
// missing middle: a stored PushSubscription per browser, VAPID-signed
// sends through the actual Web Push protocol, and pruning of subscriptions
// the push service tells us are dead.
//
// Configuration: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT
// (a mailto: or https: URL identifying the sender). Generate a keypair
// once with `npx web-push generate-vapid-keys`. With none configured, push
// degrades to a no-op and logs once — email and in-app delivery are
// unaffected, so a deployment without push keys is a supported state
// rather than a broken one.

import webpush from 'web-push'
import { prisma } from '@/lib/prisma'
import { validatePushEndpoint } from './pushEndpointValidation'

export interface PushPayload {
  title: string
  message: string
  actionUrl?: string | null
  notificationId?: string
  data?: unknown
}

let vapidConfigured: boolean | null = null

/**
 * Configure web-push once per process. Returns false when keys are absent,
 * which is a supported deployment rather than an error — callers no-op.
 */
function ensureVapidConfigured(): boolean {
  if (vapidConfigured !== null) return vapidConfigured

  const publicKey = process.env.VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT || 'mailto:support@example.com'

  if (!publicKey || !privateKey) {
    console.warn(
      'Push notifications disabled: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are not set. ' +
      'Generate a pair with `npx web-push generate-vapid-keys`. In-app and email delivery are unaffected.'
    )
    vapidConfigured = false
    return false
  }

  try {
    webpush.setVapidDetails(subject, publicKey, privateKey)
  } catch (error) {
    console.warn(
      'Push notifications disabled: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are malformed. ' +
      'Regenerate a pair with `npx web-push generate-vapid-keys`. In-app and email delivery are unaffected.',
      error
    )
    vapidConfigured = false
    return false
  }

  vapidConfigured = true
  return true
}

/** The public key the browser needs to subscribe. Null when unconfigured. */
export function getVapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY || null
}

/**
 * A 404/410 from the push service is definitive: that subscription is gone
 * (browser uninstalled, permission revoked, endpoint rotated). Anything
 * else — a timeout, a 5xx — is transient and must NOT delete the row, or a
 * momentary outage would silently unsubscribe the whole userbase.
 */
function isGoneStatus(statusCode: unknown): boolean {
  return statusCode === 404 || statusCode === 410
}

/**
 * Send a push to every subscription a user has registered.
 *
 * Returns how many were delivered. Failures never throw: push is one of
 * several delivery channels, and a dead browser subscription must not take
 * down the notification it was carrying — the in-app row is already
 * written by the time this runs.
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<number> {
  if (!ensureVapidConfigured()) return 0

  const subscriptions = await prisma.pushSubscription.findMany({ where: { userId } })
  if (subscriptions.length === 0) return 0

  const body = JSON.stringify({
    title: payload.title,
    body: payload.message,
    url: payload.actionUrl || '/',
    notificationId: payload.notificationId,
    data: payload.data,
  })

  const staleEndpoints: string[] = []
  const deliveredEndpoints: string[] = []

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body
        )
        deliveredEndpoints.push(sub.endpoint)
      } catch (error: any) {
        if (isGoneStatus(error?.statusCode)) {
          staleEndpoints.push(sub.endpoint)
        } else {
          console.error(`Push send failed for ${sub.endpoint.slice(0, 40)}…:`, error?.statusCode || error)
        }
      }
    })
  )

  if (staleEndpoints.length > 0) {
    await prisma.pushSubscription
      .deleteMany({ where: { endpoint: { in: staleEndpoints } } })
      .catch(err => console.error('Failed to prune stale push subscriptions:', err))
  }

  if (deliveredEndpoints.length > 0) {
    await prisma.pushSubscription
      .updateMany({ where: { endpoint: { in: deliveredEndpoints } }, data: { lastUsedAt: new Date() } })
      .catch(() => { /* bookkeeping only */ })
  }

  return deliveredEndpoints.length
}

/**
 * Register (or refresh) a browser's subscription.
 *
 * Keyed on endpoint, which the push service guarantees is unique per
 * subscription — re-subscribing the same browser updates the existing row
 * instead of accumulating duplicates that would each get a copy of every
 * notification.
 */
export async function savePushSubscription(params: {
  userId: string
  endpoint: string
  p256dh: string
  auth: string
  userAgent?: string | null
}): Promise<void> {
  // #418: validated at the PERSISTENCE boundary, not only the request one.
  //
  // The SSRF validator itself is sound — it survived every bypass the audit
  // attempted (userinfo tricks, IDN/punycode, trailing-dot FQDNs,
  // decimal/octal IPv4, IPv6). What it didn't have was coverage: it was
  // called at exactly one route, and this function wrote whatever it was
  // handed. A guard at the request boundary protects the routes that
  // existed when it was written; a guard here protects the DATA, which is
  // what the send path actually trusts.
  const verdict = validatePushEndpoint(params.endpoint)
  if (!verdict.valid) {
    throw new Error(`Refusing to store push endpoint: ${verdict.reason}`)
  }

  await prisma.pushSubscription.upsert({
    where: { endpoint: params.endpoint },
    create: {
      userId: params.userId,
      endpoint: params.endpoint,
      p256dh: params.p256dh,
      auth: params.auth,
      userAgent: params.userAgent || null,
    },
    update: {
      // Re-point an endpoint at whoever owns it now: browsers are shared,
      // and a stale row would otherwise deliver one user's notifications
      // to another's device.
      userId: params.userId,
      p256dh: params.p256dh,
      auth: params.auth,
      userAgent: params.userAgent || null,
    },
  })
}

/** Remove a subscription (user disabled push, or signed out of a device). */
export async function deletePushSubscription(userId: string, endpoint: string): Promise<void> {
  await prisma.pushSubscription.deleteMany({ where: { userId, endpoint } })
}
