// #492: the uptime target. Unauthenticated by design, and it must fail
// when the database does — a deployment serving 200s while every query
// throws is exactly the outage a port check misses.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: { $queryRaw: vi.fn() } }))

import { prisma } from '@/lib/prisma'
import { GET } from '../route'

const db = prisma as any

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/health', () => {
  it('is 200 when the database answers', async () => {
    db.$queryRaw.mockResolvedValue([{ '?column?': 1 }])
    const response = await GET()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
  })

  it('is 503 when the database does not', async () => {
    db.$queryRaw.mockRejectedValue(new Error('connection refused'))
    const response = await GET()
    expect(response.status).toBe(503)
  })

  it('never leaks the failure detail to an anonymous caller', async () => {
    // A database error names hosts, roles, and sometimes the connection
    // string. The status code is the whole signal a monitor needs.
    db.$queryRaw.mockRejectedValue(new Error('FATAL: password authentication failed for user "neondb_owner"'))
    const response = await GET()
    const body = JSON.stringify(await response.json())
    expect(body).not.toContain('password')
    expect(body).not.toContain('neondb_owner')
  })
})
