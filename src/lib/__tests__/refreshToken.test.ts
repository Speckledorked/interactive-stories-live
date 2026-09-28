// src/lib/__tests__/refreshToken.test.ts
//
// The refresh-token layer behind the httpOnly session cookies.
//
// The properties pinned here:
// - only hashes are stored (a DB read can never mint a session),
// - rotation is single-use with an atomic claim (concurrent redemptions
//   cannot both mint successors),
// - presenting a consumed token inside the grace window is a benign race
//   (two tabs) and gets a branch, not a logout,
// - presenting one long after is theft and burns every session.
//
// The prisma mock is an in-memory store rather than per-method stubs,
// because the interesting behavior is in the SEQUENCE (read → claim →
// re-read), which stubs cannot express.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import jwt from 'jsonwebtoken'

interface RtRow {
  id: string
  tokenHash: string
  userId: string
  expiresAt: Date
  createdAt: Date
  revokedAt: Date | null
}

function makeFakeDb() {
  const rows = new Map<string, RtRow>()
  const users = new Map<string, { id: string; email: string; tokenVersion: number }>()
  let seq = 0

  const matchWhere = (row: RtRow, where: any): boolean => {
    if (!where) return true
    if (where.id !== undefined && row.id !== where.id) return false
    if (where.tokenHash !== undefined && row.tokenHash !== where.tokenHash) return false
    if (where.userId !== undefined && row.userId !== where.userId) return false
    if (where.revokedAt !== undefined) {
      if (where.revokedAt === null) {
        if (row.revokedAt !== null) return false
      } else if (where.revokedAt.lt) {
        if (!(row.revokedAt && row.revokedAt < where.revokedAt.lt)) return false
      }
    }
    if (where.expiresAt?.gt && !(row.expiresAt > where.expiresAt.gt)) return false
    return true
  }

  const refreshToken = {
    findUnique: vi.fn(async ({ where }: any) => {
      const row = [...rows.values()].find((r) => matchWhere(r, where)) ?? null
      if (!row) return null
      return { ...row, user: users.get(row.userId) ?? null }
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      let count = 0
      for (const row of rows.values()) {
        if (matchWhere(row, where)) {
          Object.assign(row, data)
          count++
        }
      }
      return { count }
    }),
    create: vi.fn(async ({ data }: any) => {
      const row: RtRow = { id: `rt-${++seq}`, createdAt: new Date(), revokedAt: null, ...data }
      rows.set(row.tokenHash, row)
      return row
    }),
    delete: vi.fn(async ({ where }: any) => {
      const row = [...rows.values()].find((r) => matchWhere(r, where))
      if (!row) throw new Error('Record to delete does not exist.')
      rows.delete(row.tokenHash)
      return row
    }),
    deleteMany: vi.fn(async ({ where }: any) => {
      let count = 0
      for (const row of [...rows.values()]) {
        if (matchWhere(row, where)) {
          rows.delete(row.tokenHash)
          count++
        }
      }
      return { count }
    }),
  }

  const user = {
    findUnique: vi.fn(async ({ where }: any) => users.get(where.id) ?? null),
    update: vi.fn(async ({ where, data }: any) => {
      const u = users.get(where.id)
      if (!u) throw new Error('User not found')
      if (data.tokenVersion?.increment) u.tokenVersion += data.tokenVersion.increment
      return { ...u }
    }),
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma: any = {
    refreshToken,
    user,
    $transaction: vi.fn(async (arg: any) =>
      typeof arg === 'function' ? arg(prisma) : Promise.all(arg)
    ),
  }

  users.set('u1', { id: 'u1', email: 'a@example.com', tokenVersion: 0 })
  return { prisma, rows, users, refreshToken, user }
}

let db: ReturnType<typeof makeFakeDb>
vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return db.prisma
  },
}))

import {
  hashRefreshToken,
  mintRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  RefreshError,
} from '../refreshToken'

beforeEach(() => {
  db = makeFakeDb()
  vi.clearAllMocks()
  process.env.JWT_SECRET = 'test-secret-for-auth-tests'
})

const rowFor = (token: string) => db.rows.get(hashRefreshToken(token))

describe('hashRefreshToken', () => {
  it('is deterministic and hex-encoded', () => {
    const h = hashRefreshToken('abc')
    expect(h).toBe(hashRefreshToken('abc'))
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })

  it('never contains the token itself', () => {
    const token = 'my-secret-token-value'
    expect(hashRefreshToken(token)).not.toContain(token)
    expect(hashRefreshToken(token)).not.toBe(token)
  })
})

describe('mintRefreshToken', () => {
  it('stores only the hash — the plaintext never touches the database', async () => {
    const minted = await mintRefreshToken('u1')
    const row = rowFor(minted.token)!
    expect(row).toBeDefined()
    expect(row.tokenHash).toBe(hashRefreshToken(minted.token))
    expect(row.tokenHash).not.toBe(minted.token)
    expect(row.userId).toBe('u1')
    expect(row.revokedAt).toBeNull()
  })

  it('expires 30 days out', async () => {
    const before = Date.now()
    const minted = await mintRefreshToken('u1')
    const row = rowFor(minted.token)!
    const ttl = row.expiresAt.getTime() - before
    expect(ttl).toBeGreaterThan(30 * 24 * 60 * 60 * 1000 - 5000)
    // A millisecond of slop: Date.now() inside mintRefreshToken runs
    // after `before` was captured.
    expect(ttl).toBeLessThanOrEqual(30 * 24 * 60 * 60 * 1000 + 1000)
  })

  it('mints 256-bit values', async () => {
    const a = await mintRefreshToken('u1')
    const b = await mintRefreshToken('u1')
    expect(a.token).not.toBe(b.token)
    // base64url of 32 bytes
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })
})

describe('rotateRefreshToken', () => {
  it('happy path: consumes the token, mints a successor and a 15-minute access token', async () => {
    const minted = await mintRefreshToken('u1')
    const rotated = await rotateRefreshToken(minted.token)

    expect(rotated.user).toEqual({ id: 'u1', email: 'a@example.com' })
    expect(rotated.refreshToken).not.toBe(minted.token)

    // Original is consumed…
    expect(rowFor(minted.token)!.revokedAt).toBeInstanceOf(Date)
    // …and the successor is live.
    const successorRow = rowFor(rotated.refreshToken)!
    expect(successorRow.revokedAt).toBeNull()
    expect(successorRow.userId).toBe('u1')

    // The access token is a real 15-minute JWT for the user.
    const decoded = jwt.decode(rotated.accessToken) as any
    expect(decoded.userId).toBe('u1')
    expect(decoded.tokenVersion).toBe(0)
    expect(decoded.exp - decoded.iat).toBe(15 * 60)
  })

  it('rotations chain: the successor itself rotates', async () => {
    const first = await mintRefreshToken('u1')
    const second = await rotateRefreshToken(first.token)
    const third = await rotateRefreshToken(second.refreshToken)
    expect(third.refreshToken).not.toBe(second.refreshToken)
    expect(rowFor(second.refreshToken)!.revokedAt).toBeInstanceOf(Date)
  })

  it('a benign race (consumed moments ago) gets a branch, not a logout', async () => {
    // Two tabs redeem the same refresh cookie near-simultaneously: the
    // loser's cookie simply hasn't been updated yet. Revoking everything
    // here would punish normal multi-tab use as theft.
    const minted = await mintRefreshToken('u1')
    const winner = await rotateRefreshToken(minted.token)

    const loser = await rotateRefreshToken(minted.token)
    expect(loser.refreshToken).not.toBe(minted.token)
    expect(loser.refreshToken).not.toBe(winner.refreshToken)

    // Nobody was burned: the version is untouched and the winner's
    // successor is still live.
    expect(db.users.get('u1')!.tokenVersion).toBe(0)
    expect(rowFor(winner.refreshToken)!.revokedAt).toBeNull()
    expect(rowFor(loser.refreshToken)!.revokedAt).toBeNull()
  })

  it('a replay long after consumption is theft: every session is revoked', async () => {
    const minted = await mintRefreshToken('u1')
    await rotateRefreshToken(minted.token)

    // The token sat consumed for two minutes — past the race window.
    rowFor(minted.token)!.revokedAt = new Date(Date.now() - 120_000)

    const err = await rotateRefreshToken(minted.token).catch((e) => e)
    expect(err).toBeInstanceOf(RefreshError)
    expect((err as RefreshError).reason).toBe('reuse-detected')

    // Burned: version bumped (kills access JWTs) and every refresh row gone.
    expect(db.users.get('u1')!.tokenVersion).toBe(1)
    expect([...db.rows.values()].filter((r) => r.userId === 'u1')).toHaveLength(0)
  })

  it('losing the atomic claim to a fresh rotation branches; to an old one burns', async () => {
    const minted = await mintRefreshToken('u1')

    // Simulate another process winning the claim between our read and
    // our updateMany: the claim lands 0 rows, and the row is now revoked.
    db.refreshToken.updateMany.mockImplementationOnce(async ({ where, data }: any) => {
      const row = rowFor(minted.token)!
      row.revokedAt = new Date() // fresh: inside the race window
      void where
      void data
      return { count: 0 }
    })
    const branched = await rotateRefreshToken(minted.token)
    expect(branched.refreshToken).not.toBe(minted.token)
    expect(db.users.get('u1')!.tokenVersion).toBe(0)

    // Same setup, but the revocation is old: theft.
    const minted2 = await mintRefreshToken('u1')
    db.refreshToken.updateMany.mockImplementationOnce(async () => {
      rowFor(minted2.token)!.revokedAt = new Date(Date.now() - 120_000)
      return { count: 0 }
    })
    const err = await rotateRefreshToken(minted2.token).catch((e) => e)
    expect((err as RefreshError).reason).toBe('reuse-detected')
    expect(db.users.get('u1')!.tokenVersion).toBe(1)
  })

  it('refuses an expired token and deletes the row', async () => {
    const minted = await mintRefreshToken('u1')
    rowFor(minted.token)!.expiresAt = new Date(Date.now() - 1000)

    const err = await rotateRefreshToken(minted.token).catch((e) => e)
    expect((err as RefreshError).reason).toBe('expired')
    expect(rowFor(minted.token)).toBeUndefined()
  })

  it('refuses an unknown token', async () => {
    const err = await rotateRefreshToken('never-minted').catch((e) => e)
    expect((err as RefreshError).reason).toBe('unknown')
  })

  it('purges revoked rows older than a day on rotation', async () => {
    const stale = await mintRefreshToken('u1')
    await rotateRefreshToken(stale.token)
    rowFor(stale.token)!.revokedAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)

    const live = await mintRefreshToken('u1')
    await rotateRefreshToken(live.token)

    expect(rowFor(stale.token)).toBeUndefined()
    // The just-consumed token is kept for reuse detection.
    expect(rowFor(live.token)).toBeDefined()
  })
})

describe('revokeRefreshToken', () => {
  it('deletes the row; unknown tokens are silently fine', async () => {
    const minted = await mintRefreshToken('u1')
    await revokeRefreshToken(minted.token)
    expect(rowFor(minted.token)).toBeUndefined()
    // Logout must never fail because the token was already gone.
    await expect(revokeRefreshToken('never-minted')).resolves.toBeUndefined()
  })
})
