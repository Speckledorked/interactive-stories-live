// force deploy
// src/app/api/auth/login/route.ts
// User login endpoint
// Verifies credentials and returns a JWT token

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyPassword } from '@/lib/password'
import { createToken } from '@/lib/auth'
import { LoginRequest, AuthResponse, ErrorResponse } from '@/types/api'
import { checkRateLimit, rateLimitExceededResponse, getClientIp, LOGIN_LIMIT } from '@/lib/rateLimit'
import { normalizeEmail } from '@/lib/auth/normalizeEmail'

export async function POST(request: NextRequest) {
  try {
    const body: LoginRequest = await request.json()
    const { password } = body

    // Validate input
    if (!body.email || !password) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Email and password are required' },
        { status: 400 }
      )
    }

    // #302: same normalization signup now applies at write time — a
    // case-variant of the stored email must still find the account.
    const email = normalizeEmail(body.email)

    // #210: brute force protection, keyed by IP+email so a real attacker
    // rotating through many emails from one IP is still limited per pair,
    // without globally rate-limiting an entire shared IP (NAT, office,
    // school) off of every account at once.
    const rateLimitKey = `${getClientIp(request)}:${email}`
    const rateLimit = await checkRateLimit(rateLimitKey, LOGIN_LIMIT.bucket, LOGIN_LIMIT.limit, LOGIN_LIMIT.windowSeconds)
    if (!rateLimit.allowed) {
      return rateLimitExceededResponse(rateLimit)
    }

    // Find user
    const user = await prisma.user.findUnique({
      where: { email }
    })

    // Updated null-check to reference: user.password
    if (!user || !user.password) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Invalid email or password' },
        { status: 401 }
      )
    }

    // Verify password (updated: use user.password)
    const isValid = await verifyPassword(password, user.password)

    if (!isValid) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Invalid email or password' },
        { status: 401 }
      )
    }

    // Create JWT token
    const token = createToken({
      userId: user.id,
      email: user.email,
      // Stamp the version this session is minted at (#98). Bumping
      // User.tokenVersion invalidates every token carrying an older one.
      tokenVersion: user.tokenVersion,
    })

    // Return token and user info
    return NextResponse.json<AuthResponse>({
      token,
      user: {
        id: user.id,
        email: user.email
      }
    })
  } catch (error) {
    console.error('Login error:', error)
    return NextResponse.json<ErrorResponse>(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
