// src/app/api/auth/refresh/route.ts
// Session refresh endpoint.
//
// The access cookie lives 15 minutes; this is what keeps a playing
// session alive without a re-login. The client sends no body and no
// header — the httpOnly refresh cookie (path-scoped to /api/auth, so it
// arrives only here) is the entire credential.
//
// Success rotates: the presented token is consumed (single-use) and the
// response sets fresh access + refresh cookies. Failure is always a bare
// 401 with the cookies cleared — the reason (unknown, expired, reused)
// is logged server-side, never told to the caller, because a thief
// probing stolen tokens should learn nothing.

import { NextRequest, NextResponse } from 'next/server'
import {
  clearSessionCookies,
  setSessionCookies,
  REFRESH_TOKEN_COOKIE,
} from '@/lib/auth'
import { rotateRefreshToken, RefreshError } from '@/lib/refreshToken'
import { checkRateLimit, rateLimitExceededResponse, getClientIp, REFRESH_LIMIT } from '@/lib/rateLimit'

export async function POST(request: NextRequest) {
  try {
    // Pre-auth surface like login: no userId to key on yet, so key by IP.
    const rateLimit = await checkRateLimit(getClientIp(request), REFRESH_LIMIT.bucket, REFRESH_LIMIT.limit, REFRESH_LIMIT.windowSeconds)
    if (!rateLimit.allowed) {
      return rateLimitExceededResponse(rateLimit)
    }

    const presented = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value
    if (!presented) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    try {
      const rotated = await rotateRefreshToken(presented)
      const response = NextResponse.json({
        user: rotated.user,
      })
      return setSessionCookies(response, rotated.accessToken, rotated.refreshToken)
    } catch (error) {
      if (error instanceof RefreshError) {
        // reuse-detected already burned every session for this user
        // inside rotateRefreshToken; the rest just need the cookies
        // cleared so the client stops presenting a dead credential.
        console.warn(`Refresh refused (${error.reason})`)
        const denied = NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        return clearSessionCookies(denied)
      }
      throw error
    }
  } catch (error) {
    console.error('Refresh error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
