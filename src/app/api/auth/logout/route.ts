// src/app/api/auth/logout/route.ts
// Sign out of THIS session.
//
// Revokes the presented refresh token (so it cannot mint anything after
// this) and clears both session cookies. Idempotent by design: a missing
// or already-dead refresh cookie still returns 200 with the cookies
// cleared, because logout must never fail — the client's only job after
// this is to forget everything and go to /login.

import { NextRequest, NextResponse } from 'next/server'
import { clearSessionCookies, REFRESH_TOKEN_COOKIE } from '@/lib/auth'
import { revokeRefreshToken } from '@/lib/refreshToken'

export async function POST(request: NextRequest) {
  try {
    const presented = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value
    if (presented) {
      await revokeRefreshToken(presented)
    }
    const response = NextResponse.json({ signedOut: true })
    return clearSessionCookies(response)
  } catch (error) {
    console.error('Logout error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
