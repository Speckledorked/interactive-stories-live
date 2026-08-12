// src/app/api/auth/request-password-reset/route.ts
// Start a password reset. Always answers success — whether the email
// exists is not something this endpoint reveals (no account enumeration).

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { EmailService } from '@/lib/notifications/email-service'
import { checkRateLimit, rateLimitExceededResponse, PASSWORD_RESET_REQUEST_LIMIT } from '@/lib/rateLimit'

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000 // 1 hour

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json()
    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    // #210: keyed by the target email, not the caller's IP — the abuse
    // this protects against (email-bombing one inbox, or using send
    // volume to enumerate accounts) targets a specific address regardless
    // of how many IPs the caller has. Checked AFTER validating email is a
    // real string but BEFORE the identical-response-either-way lookup
    // below, so a rate-limited request never reaches the DB or email send.
    const rateLimit = await checkRateLimit(
      email.toLowerCase(),
      PASSWORD_RESET_REQUEST_LIMIT.bucket,
      PASSWORD_RESET_REQUEST_LIMIT.limit,
      PASSWORD_RESET_REQUEST_LIMIT.windowSeconds
    )
    if (!rateLimit.allowed) {
      return rateLimitExceededResponse(rateLimit)
    }

    const user = await prisma.user.findUnique({ where: { email } })
    if (user) {
      const resetToken = crypto.randomUUID()
      await prisma.user.update({
        where: { id: user.id },
        data: {
          resetToken,
          resetTokenExpires: new Date(Date.now() + RESET_TOKEN_TTL_MS),
        },
      })
      try {
        await EmailService.sendPasswordResetEmail(email, resetToken)
      } catch (emailError) {
        console.error('Password reset email failed:', emailError)
      }
    }

    // Identical response either way.
    return NextResponse.json({
      success: true,
      message: 'If an account exists for that email, a reset link has been sent.',
    })
  } catch (error) {
    console.error('Password reset request error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
