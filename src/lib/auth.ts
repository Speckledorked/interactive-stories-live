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
   * isTokenRevoked for how an absent version is treated (it still passes
   * the version check, but no longer skips the user-exists check with it).
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
 * Should this token be refused? (#98)
 *
 * A JWT is stateless, which is why it needed no database — and also why a
 * leaked one was valid for its full 30 days with no way to cut it off. This
 * is the one database read that buys revocation back, keyed on the user's
 * primary key.
 *
 * Two distinct reasons to refuse, and the difference between them matters:
 *
 *  1. **The version was bumped.** Once "log out everywhere" or a password
 *     reset raises User.tokenVersion, every token minted before it is
 *     refused on its next request.
 *  2. **The user does not exist.** A signed token outlives the row it
 *     names — an account deleted and recreated, restored from a different
 *     database, or otherwise replaced. The signature still verifies, so
 *     this used to authenticate happily and every user-scoped query then
 *     returned nothing. The result was a 200 with an empty app: campaigns
 *     gone, notification preferences blank (that route CREATES defaults
 *     when a user has none, so it looks like a fresh account rather than
 *     an error). Indistinguishable, from the outside, from "you have no
 *     data" — the failure mode that makes someone think they lost
 *     everything. Reported twice in production before it was chased down;
 *     the workaround both times was logging out and back in, which only
 *     helps if you already suspect the cause.
 *
 * **Still fails open on a read FAILURE.** That distinction is the whole
 * design of this function: an absent user and an unreadable one are not
 * the same evidence.
 *
 *  - A successful query returning no row is positive proof the user is
 *    gone. Refuse, so the client gets a 401 and redirects to login
 *    instead of rendering an empty account.
 *  - A thrown query proves nothing. A database blip must never sign the
 *    whole userbase out — the request was going to fail anyway if the DB
 *    is down, so failing closed buys no safety and costs a far worse
 *    outage.
 *
 * Note the lookup now runs for versionless tokens too, which it did not
 * before: that early return sat above the query, so a legacy token naming
 * a deleted user was never checked at all. Tokens predating session
 * revocation still pass on the VERSION question — rejecting those would
 * log out every current session on deploy — they just no longer skip the
 * existence question with it. Cost is one primary-key lookup on requests
 * that already needed the database for whatever they were doing.
 */
export async function isTokenRevoked(payload: TokenPayload | null): Promise<boolean> {
  if (!payload?.userId) return false

  try {
    const { prisma } = await import('@/lib/prisma')
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { tokenVersion: true },
    })

    // Query succeeded, no such user — positive evidence, refuse.
    if (!user) return true

    // Tokens predating session revocation carry no version; nothing to
    // compare, and the user demonstrably exists.
    if (typeof payload.tokenVersion !== 'number') return false
    // Neither does a user row predating the column's backfill.
    if (typeof user.tokenVersion !== 'number') return false

    return user.tokenVersion !== payload.tokenVersion
  } catch {
    // Unreadable is not absent. Fail open.
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
