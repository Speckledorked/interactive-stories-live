// src/app/api/auth/reset-password/route.ts
// Complete a password reset with a valid, unexpired token.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hashPassword } from '@/lib/password'
import { checkRateLimit, rateLimitExceededResponse, getClientIp, RESET_PASSWORD_LIMIT } from '@/lib/rateLimit'

export async function POST(request: NextRequest) {
  try {
    const { token, password } = await request.json()
    if (!token || typeof token !== 'string') {
      return NextResponse.json({ error: 'Reset token is required' }, { status: 400 })
    }
    if (!password || typeof password !== 'string' || password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
    }

    // #210: reset tokens are unguessable UUIDs, but a rate-limit backstop
    // against brute-force guessing costs nothing. Keyed by IP — the token
    // itself (not yet resolved to a user) can't be the key.
    const rateLimit = await checkRateLimit(getClientIp(request), RESET_PASSWORD_LIMIT.bucket, RESET_PASSWORD_LIMIT.limit, RESET_PASSWORD_LIMIT.windowSeconds)
    if (!rateLimit.allowed) {
      return rateLimitExceededResponse(rateLimit)
    }

    const user = await prisma.user.findFirst({ where: { resetToken: token } })
    if (!user || !user.resetTokenExpires || user.resetTokenExpires < new Date()) {
      return NextResponse.json(
        { error: 'This reset link is invalid or has expired. Request a new one.' },
        { status: 400 }
      )
    }

    const passwordHash = await hashPassword(password)
    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: passwordHash,
        resetToken: null,
        resetTokenExpires: null,
        // Completing a reset proves control of the inbox — that IS email
        // verification.
        emailVerified: true,
        emailVerifyToken: null,
      },
    })

    return NextResponse.json({ success: true, message: 'Password updated. You can now log in.' })
  } catch (error) {
    console.error('Password reset error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
