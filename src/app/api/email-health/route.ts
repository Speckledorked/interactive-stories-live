// src/app/api/email-health/route.ts
// Email plumbing diagnostics, sibling of /api/ai-health: reports whether
// the SMTP configuration is present and whether the SMTP server actually
// accepts our credentials (nodemailer verify — a real login handshake,
// no email sent). Never echoes secrets, only presence booleans and the
// provider's error text.

import { NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { checkRateLimit } from '@/lib/rateLimit'

export const maxDuration = 30
export const dynamic = 'force-dynamic'

export async function GET() {
  const rateLimit = await checkRateLimit('anonymous', 'email-health', 4, 60)
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: 'Too many health checks — try again in a minute.' }, { status: 429 })
  }

  const config = {
    smtpUserPresent: Boolean(process.env.SMTP_USER),
    smtpPasswordPresent: Boolean(process.env.SMTP_PASSWORD),
    smtpHost: process.env.SMTP_HOST || 'smtp.gmail.com (default)',
    smtpPort: process.env.SMTP_PORT || '587 (default)',
    // Email links (verification, password reset) are built from this —
    // unset means they point at localhost:3000 and are useless.
    appUrlPresent: Boolean(process.env.NEXT_PUBLIC_APP_URL),
    appUrl: process.env.NEXT_PUBLIC_APP_URL || 'NOT SET — email links will point at localhost:3000',
  }

  if (!config.smtpUserPresent || !config.smtpPasswordPresent) {
    return NextResponse.json({
      ok: false,
      error: 'SMTP_USER and/or SMTP_PASSWORD are not set — no email can be sent. The forgot-password page will still claim success (deliberate: it must not reveal which emails have accounts).',
      config,
    })
  }

  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASSWORD! },
    })
    // Real handshake with the SMTP server (connects + authenticates,
    // sends nothing).
    await transporter.verify()
    return NextResponse.json({
      ok: config.appUrlPresent,
      smtpLogin: 'accepted',
      ...(config.appUrlPresent
        ? {}
        : { warning: 'SMTP works, but NEXT_PUBLIC_APP_URL is unset — links inside emails will be broken.' }),
      config,
    })
  } catch (error) {
    return NextResponse.json({
      ok: false,
      smtpLogin: 'REJECTED',
      error: String(error).slice(0, 500),
      config,
    })
  }
}
