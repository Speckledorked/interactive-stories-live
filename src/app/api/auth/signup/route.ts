// src/app/api/auth/signup/route.ts
// User signup endpoint
// Creates a new user account with hashed password

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hashPassword } from '@/lib/password'
import { createToken } from '@/lib/auth'
import { SignupRequest, AuthResponse, ErrorResponse } from '@/types/api'
import { recordEvent } from '@/lib/analytics/events'
import { checkRateLimit, rateLimitExceededResponse, getClientIp, SIGNUP_LIMIT } from '@/lib/rateLimit'
import { normalizeEmail } from '@/lib/auth/normalizeEmail'
import { isUniqueConstraintViolation } from '@/lib/game/worldUpdaters/uniqueConstraintGuard'

export async function POST(request: NextRequest) {
  try {
    const body: SignupRequest = await request.json()
    const { password } = body

    // Validate input
    if (!body.email || !password) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Email and password are required' },
        { status: 400 }
      )
    }

    // #302: normalized once here and used for every subsequent read/write
    // in this route — a case-variant of an existing email (or of a
    // PLATFORM_ADMIN_EMAILS entry, which isPlatformAdminEmail already
    // lowercases on its own side) must land on the exact same row/collide
    // with the exact same unique-constraint value, not create a distinct
    // account.
    const email = normalizeEmail(body.email)

    // #210: spam account creation protection, per IP.
    const rateLimit = await checkRateLimit(getClientIp(request), SIGNUP_LIMIT.bucket, SIGNUP_LIMIT.limit, SIGNUP_LIMIT.windowSeconds)
    if (!rateLimit.allowed) {
      return rateLimitExceededResponse(rateLimit)
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email }
    })

    if (existingUser) {
      return NextResponse.json<ErrorResponse>(
        { error: 'User already exists with this email' },
        { status: 409 }
      )
    }

    // Hash password and create user
    const passwordHash = await hashPassword(password)

    const emailVerifyToken = crypto.randomUUID()
    let user
    try {
      user = await prisma.user.create({
        data: {
          email,
          password: passwordHash, // store hashed password in `password` column
          emailVerifyToken,
        },
      })
    } catch (error) {
      // The findUnique above just confirmed no matching row exists yet, so
      // this should never actually collide — but two concurrent signups
      // for the same (now-normalized) email is a genuine, if rare, race.
      // Surfaced as the same clean 409 the pre-check above returns,
      // instead of falling through to a generic 500.
      if (!isUniqueConstraintViolation(error)) throw error
      return NextResponse.json<ErrorResponse>(
        { error: 'User already exists with this email' },
        { status: 409 }
      )
    }

    // Best-effort verification email — signup must not fail because SMTP
    // did. Unverified accounts still work (soft verification); the flag
    // gates the welcome credit, and nothing else.
    //
    // The credit itself is NOT paid here. It is real money on a product with
    // open signup, and at this point all we know is that an address parses —
    // which made it free money for any throwaway inbox, behind nothing but an
    // IP rate limit. It is paid when the address is verified instead; see
    // lib/payment/welcomeCredit.ts.
    try {
      const { EmailService } = await import('@/lib/notifications/email-service')
      await EmailService.sendVerificationEmail(email, emailVerifyToken)
    } catch (emailError) {
      console.error('Verification email failed (non-critical):', emailError)
    }

    await recordEvent('SIGNUP', { userId: user.id })

    // Create JWT token
    const token = createToken({
      userId: user.id,
      email: user.email,
      // Stamp the version this session is minted at (#98). Bumping
      // User.tokenVersion invalidates every token carrying an older one.
      tokenVersion: user.tokenVersion,
    })

    // Return token and user info
    return NextResponse.json<AuthResponse>(
      {
        token,
        user: {
          id: user.id,
          email: user.email
        }
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('Signup error:', error)
    return NextResponse.json<ErrorResponse>(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
