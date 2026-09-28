// src/lib/refreshToken.ts
// Opaque refresh tokens backing the httpOnly session cookies.
//
// Why opaque instead of a JWT: a refresh JWT cannot be individually
// revoked without a denylist, which is just this table with extra steps.
// A random 256-bit value whose SHA-256 hash is stored here is revoked by
// deleting (or stamping) its row — one query, no cryptography to get
// wrong. The plaintext token exists only inside the httpOnly cookie; the
// database never sees it, so a database read alone cannot mint sessions.
//
// Rotation is single-use: every redemption revokes the presented token
// and mints a successor. Presenting an already-revoked token means the
// token was copied — the legitimate client holds the successor — so it
// is treated as theft: every session for that user is revoked.

import { createHash, randomBytes } from 'crypto'
import {
  createAccessToken,
  revokeAllSessions,
  REFRESH_TOKEN_TTL_SECONDS,
  type TokenPayload,
} from './auth'

/** Why a refresh attempt was refused. Surfaced to the route for logging;
 * the client always sees a bare 401 — the reason is not its business. */
export type RefreshFailureReason =
  /** No row for this token hash: forged, or pruned long ago. */
  | 'unknown'
  /** Past expiresAt. */
  | 'expired'
  /** Row exists but revokedAt is set and this is NOT the replay case —
   * currently unused; kept so the failure taxonomy stays complete if a
   * future caller needs it. */
  | 'revoked'
  /** A revoked token presented again: probable theft. All of the user's
   * sessions have been revoked by the time the caller sees this. */
  | 'reuse-detected'
  /** The row names a user that no longer exists. */
  | 'user-gone'

export class RefreshError extends Error {
  readonly reason: RefreshFailureReason
  constructor(reason: RefreshFailureReason) {
    super(`refresh token refused: ${reason}`)
    this.reason = reason
  }
}

/** SHA-256 of the token, hex-encoded. Hash, don't encrypt: there is no key
 * to manage and no decryption path that could become a minting path. */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

function mintPlaintext(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * Window after a rotation during which presenting the consumed token is
 * treated as a benign race (two tabs, a double-fired request) rather
 * than theft. Measured from the rotation itself, so it cannot be
 * extended by repeated presentation. See rotateRefreshToken.
 */
const REUSE_GRACE_SECONDS = 60

function withinReuseGrace(revokedAt: Date): boolean {
  return Date.now() - revokedAt.getTime() <= REUSE_GRACE_SECONDS * 1000
}

export interface MintedRefreshToken {
  /** Plaintext for the httpOnly cookie. Handled once, then forgotten. */
  token: string
  userId: string
  expiresAt: Date
}

/**
 * Create a fresh refresh-token row. Used at login/signup and on every
 * rotation. Returns the plaintext for the cookie — the caller is
 * responsible for never persisting or logging it.
 */
export async function mintRefreshToken(userId: string): Promise<MintedRefreshToken> {
  const { prisma } = await import('@/lib/prisma')
  const token = mintPlaintext()
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000)
  await prisma.refreshToken.create({
    data: {
      tokenHash: hashRefreshToken(token),
      userId,
      expiresAt,
    },
  })
  return { token, userId, expiresAt }
}

export interface RotatedSession {
  user: { id: string; email: string }
  accessToken: string
  refreshToken: string
}

/**
 * Redeem a refresh token: single-use rotation with reuse detection.
 *
 * Happy path: the presented token is live → atomically claim it (one
 * row, `revokedAt: null`, inside a transaction — see below), mint a
 * successor plus a fresh 15-minute access token, return both.
 *
 * Concurrency: two requests can present the same live token at once
 * (two tabs after sleep, a double-fired request). The claim uses
 * `updateMany` with `revokedAt: null` so exactly one wins; the loser
 * re-reads and falls into the reuse logic — where the grace window
 * (below) tells a benign race apart from theft.
 *
 * Theft path: the presented token was revoked LONG ago and is presented
 * again → someone is replaying a stolen copy. Revoke every session the
 * user has (access tokens via tokenVersion bump, refresh tokens by
 * deletion) and refuse. The legitimate client already holds the
 * successor, so it is unaffected until its own access token expires —
 * at which point it re-logs in, which is the correct outcome after a
 * suspected theft.
 *
 * Race path: the presented token was revoked MOMENTS ago (inside
 * REUSE_GRACE_SECONDS) → the loser of a benign race whose cookie hadn't
 * updated yet. It gets its own fresh successor branch rather than a
 * logout: punishing normal multi-tab use as theft would be wrong, and a
 * branch is harmless — concurrent sessions (phone + laptop) are normal.
 * An attacker gains little here: the window is measured from the
 * rotation, so it cannot be extended, and anyone presenting the token
 * after it closes still triggers the theft path.
 *
 * Housekeeping: each rotation also purges this user's rows that are both
 * expired AND revoked for over a day — they have no security value left
 * (a replay after the purge reads as 'unknown', which is still a 401).
 */
export async function rotateRefreshToken(presentedToken: string): Promise<RotatedSession> {
  const { prisma } = await import('@/lib/prisma')
  const tokenHash = hashRefreshToken(presentedToken)
  const row = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: { select: { id: true, email: true, tokenVersion: true } } },
  })

  if (!row) throw new RefreshError('unknown')
  if (!row.user) throw new RefreshError('user-gone')
  if (row.expiresAt.getTime() <= Date.now()) {
    await prisma.refreshToken.delete({ where: { id: row.id } }).catch(() => {})
    throw new RefreshError('expired')
  }

  const user = { id: row.user.id, email: row.user.email }
  const freshAccessToken = () =>
    createAccessToken({
      userId: row.user!.id,
      email: row.user!.email,
      tokenVersion: row.user!.tokenVersion,
    })

  if (row.revokedAt) {
    if (withinReuseGrace(row.revokedAt)) {
      // Benign race (see header): branch a fresh successor.
      const branch = await mintRefreshToken(row.userId)
      return { user, accessToken: freshAccessToken(), refreshToken: branch.token }
    }
    // Reuse of a long-consumed token: probable theft. Burn everything.
    await revokeAllSessions(row.userId)
    throw new RefreshError('reuse-detected')
  }

  // Atomically claim the live row: the update only lands while it is
  // still unrevoked and unexpired, so concurrent redemptions of the same
  // token cannot both mint successors. The successor is created in the
  // same transaction — a failed transaction leaves no orphan row behind.
  const now = new Date()
  const successor = await prisma.$transaction(async (tx) => {
    const claim = await tx.refreshToken.updateMany({
      where: { id: row.id, revokedAt: null, expiresAt: { gt: now } },
      data: { revokedAt: now },
    })
    if (claim.count !== 1) return null
    const plaintext = mintPlaintext()
    await tx.refreshToken.create({
      data: {
        tokenHash: hashRefreshToken(plaintext),
        userId: row.userId,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
      },
    })
    // Opportunistic purge: revoked rows only exist for reuse detection,
    // and a day is ample for the legitimate client's successor to have
    // been used (or for the theft to have been noticed).
    await tx.refreshToken.deleteMany({
      where: {
        userId: row.userId,
        revokedAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    })
    return plaintext
  })

  if (successor) {
    return { user, accessToken: freshAccessToken(), refreshToken: successor }
  }

  // Lost the race: the row changed between our read and our claim.
  // Re-read to decide between benign race, expiry, and theft.
  const fresh = await prisma.refreshToken.findUnique({ where: { tokenHash } })
  if (!fresh) throw new RefreshError('unknown')
  if (fresh.expiresAt.getTime() <= Date.now()) throw new RefreshError('expired')
  if (fresh.revokedAt && withinReuseGrace(fresh.revokedAt)) {
    const branch = await mintRefreshToken(row.userId)
    return { user, accessToken: freshAccessToken(), refreshToken: branch.token }
  }
  await revokeAllSessions(row.userId)
  throw new RefreshError('reuse-detected')
}

/**
 * Revoke one refresh token by its presented value. Idempotent: unknown
 * tokens are silently fine — logout must never fail because the token
 * was already gone.
 */
export async function revokeRefreshToken(presentedToken: string): Promise<void> {
  const { prisma } = await import('@/lib/prisma')
  await prisma.refreshToken
    .delete({ where: { tokenHash: hashRefreshToken(presentedToken) } })
    .catch(() => {})
}
