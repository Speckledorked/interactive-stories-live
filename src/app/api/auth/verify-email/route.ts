// src/app/api/auth/verify-email/route.ts
// Email verification landing: the link in the verification email points
// here. Marks the account verified and bounces to the login page with a
// banner flag — no page of its own needed.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkRateLimit, getClientIp, VERIFY_EMAIL_LIMIT } from '@/lib/rateLimit'
import { grantWelcomeCredit } from '@/lib/payment/welcomeCredit'

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')
  const loginUrl = new URL('/login', request.nextUrl.origin)

  if (!token) {
    loginUrl.searchParams.set('verified', '0')
    return NextResponse.redirect(loginUrl)
  }

  // #210: token brute-force backstop, keyed by IP. Redirects (not a 429
  // JSON response) to match this route's existing all-outcomes-redirect
  // shape — a rate-limited attempt just reads as another failed
  // verification rather than a different response type.
  const rateLimit = await checkRateLimit(getClientIp(request), VERIFY_EMAIL_LIMIT.bucket, VERIFY_EMAIL_LIMIT.limit, VERIFY_EMAIL_LIMIT.windowSeconds)
  if (!rateLimit.allowed) {
    loginUrl.searchParams.set('verified', '0')
    return NextResponse.redirect(loginUrl)
  }

  try {
    const user = await prisma.user.findFirst({ where: { emailVerifyToken: token } })
    if (!user) {
      loginUrl.searchParams.set('verified', '0')
      return NextResponse.redirect(loginUrl)
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: true, emailVerifyToken: null },
    })

    // The welcome credit is paid here rather than at signup, so it costs a
    // real inbox rather than a string with an @ in it. Idempotent by
    // construction: the token is consumed above, so a replayed link finds no
    // user and never reaches this line. Never throws — a funding problem must
    // not turn a successful verification into a failed one.
    await grantWelcomeCredit(user.id)

    loginUrl.searchParams.set('verified', '1')
    return NextResponse.redirect(loginUrl)
  } catch (error) {
    console.error('Email verification error:', error)
    loginUrl.searchParams.set('verified', '0')
    return NextResponse.redirect(loginUrl)
  }
}
