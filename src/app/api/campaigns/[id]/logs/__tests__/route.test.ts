// src/app/api/campaigns/[id]/logs/__tests__/route.test.ts
// #135 (cont.) — the Story Log had no test coverage: GET's plain
// membership gate vs. POST's admin-only gate (log entries are meant to
// come from admins/AI, not players) were both unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ getUser: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({ getCampaignMembership: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaignLog: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn(), create: vi.fn() },
    campaignMembership: { findFirst: vi.fn() },
  },
}))

import { getUser } from '@/lib/auth'
import { getCampaignMembership } from '@/lib/db/campaignAccess'
import { prisma } from '@/lib/prisma'
import { GET, POST } from '../route'

const db = prisma as any

function getRequest(query = '') {
  return new NextRequest(`http://localhost/api/campaigns/camp1/logs${query}`)
}

function postRequest(body: unknown) {
  return new NextRequest('http://localhost/api/campaigns/camp1/logs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getUser as any).mockResolvedValue({ userId: 'admin1' })
  ;(getCampaignMembership as any).mockResolvedValue({ role: 'PLAYER' })
  db.campaignLog.findMany.mockResolvedValue([])
  db.campaignLog.count.mockResolvedValue(0)
})

describe('GET', () => {
  it('rejects an unauthenticated request', async () => {
    ;(getUser as any).mockResolvedValue(null)
    const response = await GET(getRequest(), { params: { id: 'camp1' } })
    expect(response.status).toBe(401)
  })

  it('rejects a non-member', async () => {
    ;(getCampaignMembership as any).mockResolvedValue(null)
    const response = await GET(getRequest(), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
  })

  it('returns the most recent page of campaign logs, oldest-first, for a member', async () => {
    // findMany itself is queried newest-first (desc) — the route reverses
    // the page before returning it, so oldest-first is what the test
    // asserts on the response body, not what the mock returns.
    db.campaignLog.findMany.mockResolvedValue([
      { id: 'l2', title: 'Turn 2', turnNumber: 2 },
      { id: 'l1', title: 'Turn 1', turnNumber: 1 },
    ])
    db.campaignLog.count.mockResolvedValue(2)
    const response = await GET(getRequest(), { params: { id: 'camp1' } })
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.logs).toEqual([
      { id: 'l1', title: 'Turn 1', turnNumber: 1 },
      { id: 'l2', title: 'Turn 2', turnNumber: 2 },
    ])
    expect(body.sceneCount).toBe(2)
    expect(db.campaignLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { campaignId: 'camp1' },
      orderBy: [{ turnNumber: 'desc' }, { createdAt: 'desc' }],
      take: 30,
    }))
  })

  it('reports hasMore true when a full page comes back, false otherwise', async () => {
    const fullPage = Array.from({ length: 30 }, (_, i) => ({ id: `l${i}`, turnNumber: i }))
    db.campaignLog.findMany.mockResolvedValue(fullPage)
    const full = await GET(getRequest(), { params: { id: 'camp1' } })
    expect((await full.json()).hasMore).toBe(true)

    db.campaignLog.findMany.mockResolvedValue(fullPage.slice(0, 5))
    const partial = await GET(getRequest(), { params: { id: 'camp1' } })
    expect((await partial.json()).hasMore).toBe(false)
  })

  it('clamps an oversized limit to the max page size', async () => {
    await GET(getRequest('?limit=99999'), { params: { id: 'camp1' } })
    expect(db.campaignLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }))
  })

  it('resolves a before cursor and queries strictly older entries', async () => {
    db.campaignLog.findFirst.mockResolvedValue({ turnNumber: 5, createdAt: new Date('2026-01-05') })
    await GET(getRequest('?before=l5'), { params: { id: 'camp1' } })
    expect(db.campaignLog.findFirst).toHaveBeenCalledWith({
      where: { id: 'l5', campaignId: 'camp1' },
      select: { turnNumber: true, createdAt: true },
    })
    expect(db.campaignLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        campaignId: 'camp1',
        OR: [
          { turnNumber: { lt: 5 } },
          { turnNumber: 5, createdAt: { lt: new Date('2026-01-05') } },
        ],
      },
    }))
  })

  it('rejects an unresolvable or foreign-campaign before cursor', async () => {
    db.campaignLog.findFirst.mockResolvedValue(null)
    const response = await GET(getRequest('?before=bogus'), { params: { id: 'camp1' } })
    expect(response.status).toBe(400)
    expect(db.campaignLog.findMany).not.toHaveBeenCalled()
  })
})

describe('POST', () => {
  it('rejects an unauthenticated request', async () => {
    ;(getUser as any).mockResolvedValue(null)
    const response = await POST(postRequest({ title: 'Test' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(401)
  })

  it('rejects a non-admin', async () => {
    db.campaignMembership.findFirst.mockResolvedValue(null)
    const response = await POST(postRequest({ title: 'Test' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
    expect(db.campaignLog.create).not.toHaveBeenCalled()
  })

  it('creates the log entry for an admin', async () => {
    db.campaignMembership.findFirst.mockResolvedValue({ id: 'mem1', role: 'ADMIN' })
    db.campaignLog.create.mockResolvedValue({ id: 'l1', title: 'Test' })
    const response = await POST(postRequest({ turnNumber: 1, title: 'Test', summary: 's' }), { params: { id: 'camp1' } })
    const body = await response.json()
    expect(response.status).toBe(201)
    expect(body.log).toEqual({ id: 'l1', title: 'Test' })
    expect(db.campaignLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ campaignId: 'camp1', title: 'Test', entryType: 'scene', highlights: [] }),
    }))
  })

  it('returns 500 on an unexpected error', async () => {
    db.campaignMembership.findFirst.mockRejectedValue(new Error('db down'))
    const response = await POST(postRequest({ title: 'Test' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(500)
  })
})
