// src/app/api/public/worlds/__tests__/route.test.ts
//
// #490 — the public directory. Unauthenticated by design, which makes two
// things load-bearing: it must never return a snapshot (that is what
// forking is for, and shipping every definition in a list hands the whole
// catalogue to a scraper in one request), and it must never return an
// email.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: { publishedWorld: { findMany: vi.fn(), count: vi.fn() } },
}))

import { prisma } from '@/lib/prisma'
import { GET } from '../route'

const db = prisma as any

function req(query = '') {
  return new NextRequest(`http://localhost/api/public/worlds${query}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  db.publishedWorld.findMany.mockResolvedValue([
    {
      slug: 'the-long-winter', title: 'The Long Winter', description: 'd',
      universe: 'Original', forkCount: 3, createdAt: new Date(),
      publisher: { name: 'Ada' },
    },
  ])
  db.publishedWorld.count.mockResolvedValue(1)
})

describe('what it returns', () => {
  it('returns cards, never snapshots', async () => {
    const body = await (await GET(req())).json()

    expect(body.worlds[0]).toMatchObject({ slug: 'the-long-winter', forkCount: 3, author: 'Ada' })
    expect(JSON.stringify(body)).not.toContain('snapshot')
    // The select itself must not ask for it — a later field addition that
    // spread the row would otherwise leak every definition at once.
    expect(db.publishedWorld.findMany.mock.calls[0][0].select.snapshot).toBeUndefined()
  })

  it('never exposes a publisher\'s email', async () => {
    db.publishedWorld.findMany.mockResolvedValue([
      {
        slug: 's', title: 't', description: 'd', universe: 'u', forkCount: 0,
        createdAt: new Date(), publisher: { name: null },
      },
    ])

    const body = await (await GET(req())).json()

    expect(body.worlds[0].author).toBe('Anonymous')
    expect(db.publishedWorld.findMany.mock.calls[0][0].select.publisher.select.email).toBeUndefined()
  })

  it('shows only listed worlds', async () => {
    await GET(req())
    expect(db.publishedWorld.findMany.mock.calls[0][0].where.isListed).toBe(true)
  })

  it('orders by forks taken, then recency', async () => {
    await GET(req())
    expect(db.publishedWorld.findMany.mock.calls[0][0].orderBy).toEqual([
      { forkCount: 'desc' },
      { createdAt: 'desc' },
    ])
  })
})

describe('paging and search', () => {
  it('caps a caller-supplied limit', async () => {
    await GET(req('?limit=9999'))
    expect(db.publishedWorld.findMany.mock.calls[0][0].take).toBeLessThanOrEqual(48)
  })

  it('ignores a nonsense limit rather than failing', async () => {
    await GET(req('?limit=banana'))
    expect(db.publishedWorld.findMany.mock.calls[0][0].take).toBeGreaterThan(0)
  })

  it('ignores a negative offset', async () => {
    await GET(req('?offset=-5'))
    expect(db.publishedWorld.findMany.mock.calls[0][0].skip).toBe(0)
  })

  it('searches title and universe, case-insensitively', async () => {
    await GET(req('?q=winter'))
    const where = db.publishedWorld.findMany.mock.calls[0][0].where
    expect(where.OR).toEqual([
      { title: { contains: 'winter', mode: 'insensitive' } },
      { universe: { contains: 'winter', mode: 'insensitive' } },
    ])
  })

  it('reports hasMore against the real total, not the page', async () => {
    db.publishedWorld.count.mockResolvedValue(100)
    const body = await (await GET(req())).json()
    expect(body).toMatchObject({ total: 100, hasMore: true })
  })
})
