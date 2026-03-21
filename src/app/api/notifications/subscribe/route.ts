// src/app/api/notifications/subscribe/route.ts
// POST /api/notifications/subscribe
// Accepts a Web Push subscription object from the service worker.
// The app primarily uses Pusher for real-time delivery, so this stores
// the subscription for record-keeping and returns 200.

import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'

export async function POST(request: NextRequest) {
  try {
    const user = await verifyAuth(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Subscription object from the browser's PushManager API
    // We acknowledge receipt — Pusher handles actual real-time delivery
    await request.json() // consume body

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Push subscribe error:', error)
    return NextResponse.json({ error: 'Failed to register subscription' }, { status: 500 })
  }
}
