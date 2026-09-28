// force deploy
// src/app/api/auth/login/route.ts
// User login endpoint
// Verifies credentials and sets the httpOnly session cookies (15-minute
// access JWT + 30-day rotating refresh token). The response body carries
// the user profile only — never a token.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyPassword } from '@/lib/password'
import { createAccessToken, setSessionCookies, type TokenPayload } from '@/lib/auth'
import { mintRefreshToken } from '@/lib/refreshToken'
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

    // Stamp lastSeenAt. Until this line existed the column had readers and
    // no writer anywhere — the friends page rendered "last seen" from a value
    // nothing ever set, so every friend showed as plain "Offline" forever
    // (confirmed in production: zero non-null values). Login is a coarse
    // proxy for presence, but it is a TRUE one; a wrong-but-confident
    // timestamp would be worse. Fire-and-forget: a presence stamp must never
    // fail a login.
    prisma.user
      .update({ where: { id: user.id }, data: { lastSeenAt: new Date() } })
      .catch((err) => console.error('lastSeenAt stamp failed (non-critical):', err))

    // Mint the session: a short-lived access JWT in an httpOnly cookie,
    // plus an opaque refresh token in a second httpOnly cookie. The
    // response body carries the user only — returning either token to
    // JavaScript would undo the httpOnly protection.
    const payload: TokenPayload = {
      userId: user.id,
      email: user.email,
      // Stamp the version this session is minted at (#98). Bumping
      // User.tokenVersion invalidates every token carrying an older one.
      tokenVersion: user.tokenVersion,
    }
    const accessToken = createAccessToken(payload)
    const refresh = await mintRefreshToken(user.id)

    const response = NextResponse.json<AuthResponse>({
      user: {
        id: user.id,
        email: user.email
      }
    })
    return setSessionCookies(response, accessToken, refresh.token)
  } catch (error) {
    console.error('Login error:', error)
    return NextResponse.json<ErrorResponse>(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
