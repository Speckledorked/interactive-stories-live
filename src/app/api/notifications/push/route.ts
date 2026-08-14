// src/app/api/notifications/push/route.ts
//
// Browser push subscription management (README #92).
//
// GET returns the VAPID public key the browser needs to call
// pushManager.subscribe(). POST stores the resulting subscription; DELETE
// removes it. This is the flow whose absence made the previous push
// scaffolding unable to ever fire.

import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/auth'
import { getVapidPublicKey, savePushSubscription, deletePushSubscription } from '@/lib/notifications/push-service'
import { validatePushEndpoint } from '@/lib/notifications/pushEndpointValidation'

export async function GET(request: NextRequest) {
  const user = await getUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const publicKey = getVapidPublicKey()
  // `configured: false` is a normal deployment state, not an error — the
  // client uses it to hide the push toggle rather than show a control that
  // can't work.
  return NextResponse.json({ configured: Boolean(publicKey), publicKey })
}

export async function POST(request: NextRequest) {
  try {
    const user = await getUser(request)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const endpoint: unknown = body?.endpoint
    const p256dh: unknown = body?.keys?.p256dh
    const auth: unknown = body?.keys?.auth

    if (typeof endpoint !== 'string' || typeof p256dh !== 'string' || typeof auth !== 'string') {
      return NextResponse.json(
        { error: 'A push subscription with endpoint and keys.p256dh/keys.auth is required' },
        { status: 400 }
      )
    }

    // #303: reject at registration time, not silently at send time — a
    // stored endpoint is a server-initiated, VAPID-signed outbound request
    // target (push-service.ts's sendPushToUser), so an unvalidated one is
    // a self-service SSRF primitive.
    const validation = validatePushEndpoint(endpoint)
    if (!validation.valid) {
      return NextResponse.json({ error: `Invalid push endpoint: ${validation.reason}` }, { status: 400 })
    }

    await savePushSubscription({
      userId: user.userId,
      endpoint,
      p256dh,
      auth,
      userAgent: request.headers.get('user-agent'),
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Save push subscription error:', error)
    return NextResponse.json({ error: 'Failed to save push subscription' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await getUser(request)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const endpoint: unknown = body?.endpoint
    if (typeof endpoint !== 'string') {
      return NextResponse.json({ error: 'endpoint is required' }, { status: 400 })
    }

    await deletePushSubscription(user.userId, endpoint)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete push subscription error:', error)
    return NextResponse.json({ error: 'Failed to delete push subscription' }, { status: 500 })
  }
}
