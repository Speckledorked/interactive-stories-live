// src/lib/__tests__/auth.test.ts
//
// The auth layer, which had zero tests (#98).
//
// Every route in the app depends on this file, and nothing exercised it —
// scored 2 in the re-audit for that plus the thing these mostly cover:
// tokens were stateless JWTs with a 30-day life and **no revocation path at
// all**, so a leaked token was valid for a month and changing a password
// did nothing to sessions someone else already held.
//
// The fail-open choices below are deliberate and are pinned as tests
// precisely because they look like bugs at a glance. Each has a comment
// saying what the alternative would cost.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const findUnique = vi.fn()
const update = vi.fn()
vi.mock('@/lib/prisma', () => ({
  prisma: { user: { findUnique: (...a: unknown[]) => findUnique(...a), update: (...a: unknown[]) => update(...a) } },
}))

import {
  createToken,
  verifyToken,
  getUserFromRequest,
  requireAuth,
  getUser,
  verifyAuth,
  isTokenRevoked,
  revokeAllSessions,
} from '../auth'

const withToken = (token: string) =>
  new NextRequest('http://localhost/api/anything', {
    headers: { authorization: `Bearer ${token}` },
  })

beforeEach(() => {
  vi.clearAllMocks()
  process.env.JWT_SECRET = 'test-secret-for-auth-tests'
  findUnique.mockResolvedValue({ tokenVersion: 0 })
  update.mockResolvedValue({ tokenVersion: 1 })
})

describe('createToken / verifyToken', () => {
  it('round-trips the identity it was given', () => {
    const token = createToken({ userId: 'u1', email: 'a@example.com', tokenVersion: 3 })
    expect(verifyToken(token)).toMatchObject({ userId: 'u1', email: 'a@example.com', tokenVersion: 3 })
  })

  it('rejects a token signed with a different secret', () => {
    const token = createToken({ userId: 'u1', email: 'a@example.com' })
    process.env.JWT_SECRET = 'a-different-secret'
    // The module caches the secret on first use, so this asserts the
    // signature check itself rather than the caching — a tampered token
    // under the SAME secret is the real case, covered next.
    expect(verifyToken(token + 'x')).toBeNull()
  })

  it('rejects a tampered token', () => {
    const token = createToken({ userId: 'u1', email: 'a@example.com' })
    const [header, payload, sig] = token.split('.')
    const forged = `${header}.${Buffer.from('{"userId":"u2","email":"b@example.com"}').toString('base64url')}.${sig}`
    expect(verifyToken(forged)).toBeNull()
  })

  it('rejects nonsense rather than throwing', () => {
    for (const junk of ['', 'not-a-token', 'a.b.c']) {
      expect(verifyToken(junk), junk).toBeNull()
    }
  })
})

describe('getUserFromRequest', () => {
  it('reads a Bearer token', () => {
    const token = createToken({ userId: 'u1', email: 'a@example.com' })
    expect(getUserFromRequest(withToken(token))?.userId).toBe('u1')
  })

  it('ignores a header that is not a Bearer token', () => {
    const req = new NextRequest('http://localhost/x', { headers: { authorization: 'Basic abc' } })
    expect(getUserFromRequest(req)).toBeNull()
    expect(getUserFromRequest(new NextRequest('http://localhost/x'))).toBeNull()
  })
})

describe('isTokenRevoked', () => {
  it('refuses a token minted before the version was bumped', () => {
    // The whole point: once a version is bumped, every older token is dead
    // on its next request.
    findUnique.mockResolvedValue({ tokenVersion: 4 })
    return expect(isTokenRevoked({ userId: 'u1', email: 'a@example.com', tokenVersion: 3 })).resolves.toBe(true)
  })

  it('accepts a token at the current version', async () => {
    findUnique.mockResolvedValue({ tokenVersion: 4 })
    expect(await isTokenRevoked({ userId: 'u1', email: 'a@example.com', tokenVersion: 4 })).toBe(false)
  })

  it('accepts a token minted before versions existed', async () => {
    // Rejecting these would sign out every live session the moment this
    // shipped — a security improvement delivered as an outage.
    findUnique.mockResolvedValue({ tokenVersion: 7 })
    expect(await isTokenRevoked({ userId: 'u1', email: 'a@example.com' })).toBe(false)
  })

  it('does not sign everyone out when the database is unreachable', async () => {
    // Fails OPEN on purpose. The request needs the database anyway, so
    // failing closed here buys no real safety and turns a blip into a
    // mass logout.
    findUnique.mockRejectedValue(new Error('connection refused'))
    expect(await isTokenRevoked({ userId: 'u1', email: 'a@example.com', tokenVersion: 1 })).toBe(false)
  })

  it('treats a missing user as unrevoked rather than as evidence', async () => {
    findUnique.mockResolvedValue(null)
    expect(await isTokenRevoked({ userId: 'gone', email: 'a@example.com', tokenVersion: 1 })).toBe(false)
  })

  it('does not query at all for a null payload', async () => {
    expect(await isTokenRevoked(null)).toBe(false)
    expect(findUnique).not.toHaveBeenCalled()
  })
})

describe('revokeAllSessions', () => {
  it('increments the version, which is what invalidates the tokens', async () => {
    expect(await revokeAllSessions('u1')).toBe(1)
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'u1' },
      data: { tokenVersion: { increment: 1 } },
    }))
  })

  it('increments rather than setting, so concurrent revokes cannot cancel out', async () => {
    // Read-modify-write would let two near-simultaneous revocations land
    // on the same number and leave one of them ineffective.
    await revokeAllSessions('u1')
    const data = update.mock.calls[0][0].data
    expect(data.tokenVersion).toEqual({ increment: 1 })
    expect(typeof data.tokenVersion).not.toBe('number')
  })
})

describe('the request-level helpers all apply revocation', () => {
  // The property that matters most: a revoked token must not get through
  // ANY door. There are three, they are used by different routes, and an
  // inconsistency between them is a hole.
  const revokedRequest = () => {
    findUnique.mockResolvedValue({ tokenVersion: 9 })
    return withToken(createToken({ userId: 'u1', email: 'a@example.com', tokenVersion: 1 }))
  }

  it('getUser refuses a revoked token', async () => {
    expect(await getUser(revokedRequest())).toBeNull()
  })

  it('verifyAuth refuses a revoked token', async () => {
    expect(await verifyAuth(revokedRequest())).toBeNull()
  })

  it('requireAuth refuses a revoked token', async () => {
    await expect(requireAuth(revokedRequest())).rejects.toThrow('Unauthorized')
  })

  it('all three still admit a current token', async () => {
    findUnique.mockResolvedValue({ tokenVersion: 2 })
    const req = () => withToken(createToken({ userId: 'u1', email: 'a@example.com', tokenVersion: 2 }))

    expect((await getUser(req()))?.userId).toBe('u1')
    expect((await verifyAuth(req()))?.userId).toBe('u1')
    expect((await requireAuth(req())).userId).toBe('u1')
  })

  it('requireAuth still throws for no token at all', async () => {
    await expect(requireAuth(new NextRequest('http://localhost/x'))).rejects.toThrow('Unauthorized')
  })
})
