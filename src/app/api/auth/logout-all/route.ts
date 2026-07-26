// src/app/api/auth/logout-all/route.ts
//
// "Log out everywhere" (#98).
//
// Tokens are stateless JWTs with a 30-day life, so before session
// revocation existed there was no answer to "I think my token leaked" and
// no answer to "does changing my password end the sessions someone else
// already has?" — it didn't. This is that answer: bumping the caller's
// tokenVersion invalidates every token minted before now, including the one
// making this request.
//
// Deliberately scoped to the caller's OWN sessions. Revoking someone else's
// is an admin capability with a different threat model, and quietly
// accepting a userId in the body would make this an account-takeover tool.

import { NextRequest, NextResponse } from 'next/server'
import { getUser, revokeAllSessions } from '@/lib/auth'
import { SESSION_REVOKE_LIMIT, checkRateLimit, rateLimitExceededResponse } from '@/lib/rateLimit'

export async function POST(request: NextRequest) {
  try {
    const user = await getUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Rate limited like the other auth endpoints: this is cheap to call and
    // writes to the user row every time.
    const limit = await checkRateLimit(user.userId, SESSION_REVOKE_LIMIT.bucket, SESSION_REVOKE_LIMIT.limit, SESSION_REVOKE_LIMIT.windowSeconds)
    if (!limit.allowed) return rateLimitExceededResponse(limit)

    const tokenVersion = await revokeAllSessions(user.userId)

    return NextResponse.json({
      revoked: true,
      tokenVersion,
      // Said plainly because it is the surprising part: the caller's
      // current token stops working too. That is the point of the button.
      message: 'All sessions signed out, including this one. Please sign in again.',
    })
  } catch (error) {
    console.error('Logout-all error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
