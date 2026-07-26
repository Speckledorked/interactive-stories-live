// src/lib/auth.ts
// Authentication helpers using JWT (JSON Web Tokens)
// Tokens are used to verify user identity without checking the database every time

import jwt from 'jsonwebtoken'
import { NextRequest } from 'next/server'
import { headers } from 'next/headers'

// Secret hygiene: a hardcoded fallback in production means anyone who has
// read this file can mint valid tokens. Production without JWT_SECRET now
// fails loudly at first use; the dev fallback survives for local work.
// Lazy (not module-scope) so builds without env vars still compile.
let cachedSecret: string | null = null
export function getJwtSecret(): string {
  if (cachedSecret) return cachedSecret
  const secret = process.env.JWT_SECRET
  if (secret) {
    cachedSecret = secret
    return secret
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set in production — refusing to run with a known fallback secret')
  }
  cachedSecret = 'dev-only-secret-not-for-production'
  return cachedSecret
}

// What we store inside the JWT token
export interface TokenPayload {
  userId: string
  email: string
  /**
   * The User.tokenVersion this token was minted at (#98).
   *
   * Optional because tokens issued before session revocation existed do not
   * carry one, and those must keep working — shipping a security
   * improvement by logging out the entire userbase is its own outage. See
   * isTokenRevoked for how an absent version is treated.
   */
  tokenVersion?: number
}

/**
 * Create a JWT token for a user
 * @param payload - User info to encode
 * @returns JWT token string
 */
export function createToken(payload: TokenPayload): string {
  return jwt.sign(payload, getJwtSecret(), {
    expiresIn: '30d', // Token expires in 30 days
  })
}

/**
 * Verify and decode a JWT token.
 *
 * Signature and expiry only — deliberately synchronous and DB-free, so it
 * stays usable anywhere. Revocation is a separate, asynchronous question:
 * see isTokenRevoked, which the request-level helpers below apply.
 */
export function verifyToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, getJwtSecret()) as TokenPayload
  } catch (error) {
    return null
  }
}

/**
 * Has this token been revoked since it was issued? (#98)
 *
 * A JWT is stateless, which is why it needed no database — and also why a
 * leaked one was valid for its full 30 days with no way to cut it off. This
 * is the one database read that buys revocation back, keyed on the user's
 * primary key.
 *
 * **Fails open on a read failure, and on a token with no version.** That is
 * a deliberate trade, not an oversight:
 *
 *  - A token minted before this existed has no version. Rejecting those
 *    would log out every current session on deploy.
 *  - A database blip must not sign the whole userbase out. The request was
 *    going to fail anyway if the DB is down — every route needs it — so
 *    failing closed here buys no real safety and costs a much worse
 *    outage mode.
 *
 * What it does guarantee is the case that matters: once a version has been
 * bumped, every token minted before it is refused on its next request.
 */
export async function isTokenRevoked(payload: TokenPayload | null): Promise<boolean> {
  if (!payload?.userId) return false
  // Tokens predating session revocation carry no version.
  if (typeof payload.tokenVersion !== 'number') return false

  try {
    const { prisma } = await import('@/lib/prisma')
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { tokenVersion: true },
    })
    // An unreadable or absent user is not positive evidence of revocation.
    if (!user || typeof user.tokenVersion !== 'number') return false
    return user.tokenVersion !== payload.tokenVersion
  } catch {
    return false
  }
}

/**
 * Invalidate every token this user currently holds.
 *
 * The endpoint behind "log out everywhere", and what a password reset
 * should call — a reset that leaves stolen sessions alive is not a reset.
 */
export async function revokeAllSessions(userId: string): Promise<number> {
  const { prisma } = await import('@/lib/prisma')
  const user = await prisma.user.update({
    where: { id: userId },
    data: { tokenVersion: { increment: 1 } },
    select: { tokenVersion: true },
  })
  return user.tokenVersion
}

/**
 * Extract user info from the Authorization header
 * @param request - Next.js request object
 * @returns User info or null if not authenticated
 */
export function getUserFromRequest(request: NextRequest): TokenPayload | null {
  const authHeader = request.headers.get('authorization')

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null
  }

  const token = authHeader.substring(7) // Remove "Bearer " prefix
  return verifyToken(token)
}

/**
 * Middleware helper to require authentication
 * Throws an error if user is not authenticated
 */
export async function requireAuth(request: NextRequest): Promise<TokenPayload> {
  const user = getUserFromRequest(request)

  if (!user || (await isTokenRevoked(user))) {
    throw new Error('Unauthorized')
  }

  return user
}

// -------------------------------------------
// Convenience helper used by API routes and server code
// Supports both getUser(request) and getUser()
// -------------------------------------------

export async function getUser(request?: NextRequest): Promise<TokenPayload | null> {
  // If an explicit NextRequest is passed (API routes), use it
  if (request) {
    const user = getUserFromRequest(request)
    return (await isTokenRevoked(user)) ? null : user
  }

  // Fallback: read from Next.js request headers in server components/actions
  try {
    const authHeader = headers().get('authorization')

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null
    }

    const token = authHeader.substring(7)
    const user = verifyToken(token)
    return (await isTokenRevoked(user)) ? null : user
  } catch {
    return null
  }
}

/**
 * Verify authentication and return user, or null if not authenticated
 * Used by API routes that need auth but want to handle unauthorized state themselves
 */
export async function verifyAuth(request: NextRequest): Promise<TokenPayload | null> {
  const user = getUserFromRequest(request)
  return (await isTokenRevoked(user)) ? null : user
}
