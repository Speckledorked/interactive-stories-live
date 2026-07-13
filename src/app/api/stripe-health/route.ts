// src/app/api/stripe-health/route.ts
// Stripe diagnostics, sibling of /api/ai-health and /api/email-health:
// reports whether the Stripe env vars are present, and — for the secret
// key — whether it's actually valid, via a safe read-only API call
// (balance.retrieve, no side effects, no charge). Never echoes secret
// values. Rate-limited.

import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/rateLimit'

export const maxDuration = 30
export const dynamic = 'force-dynamic'

export async function GET() {
  const rateLimit = await checkRateLimit('anonymous', 'stripe-health', 4, 60)
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: 'Too many health checks — try again in a minute.' }, { status: 429 })
  }

  const config = {
    secretKeyPresent: Boolean(process.env.STRIPE_SECRET_KEY),
    webhookSecretPresent: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
    appUrlPresent: Boolean(process.env.NEXT_PUBLIC_APP_URL),
    appUrl: process.env.NEXT_PUBLIC_APP_URL || 'NOT SET — checkout success/cancel URLs will point at localhost:3000',
  }

  if (!config.secretKeyPresent) {
    return NextResponse.json({
      ok: false,
      error: 'STRIPE_SECRET_KEY is not set — "Add Funds" will fail immediately with a 500 whenever anyone tries it.',
      config,
    })
  }

  try {
    const Stripe = (await import('stripe')).default
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2026-02-25.clover' as any, typescript: true })
    // Read-only, no side effects — just proves the key authenticates.
    await stripe.balance.retrieve()
    return NextResponse.json({
      ok: config.webhookSecretPresent && config.appUrlPresent,
      secretKey: 'valid',
      ...(config.webhookSecretPresent ? {} : { warning: 'STRIPE_WEBHOOK_SECRET is not set — completed payments will not credit balances (the webhook route will 500 on every event).' }),
      ...(config.appUrlPresent ? {} : { warning2: 'NEXT_PUBLIC_APP_URL is not set — checkout redirects will send players back to localhost:3000.' }),
      config,
    })
  } catch (error) {
    return NextResponse.json({
      ok: false,
      secretKey: 'REJECTED',
      error: String(error).slice(0, 500),
      config,
    })
  }
}
