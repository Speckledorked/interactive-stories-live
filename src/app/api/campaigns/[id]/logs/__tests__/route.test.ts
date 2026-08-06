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
    campaignLog: { findMany: vi.fn(), create: vi.fn() },
    campaignMembership: { findFirst: vi.fn() },
  },
}))

import { getUser } from '@/lib/auth'
import { getCampaignMembership } from '@/lib/db/campaignAccess'
import { prisma } from '@/lib/prisma'
import { GET, POST } from '../route'

const db = prisma as any

function getRequest() {
  return new NextRequest('http://localhost/api/campaigns/camp1/logs')
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

  it('returns the campaign logs for a member', async () => {
    db.campaignLog.findMany.mockResolvedValue([{ id: 'l1', title: 'Turn 1' }])
    const response = await GET(getRequest(), { params: { id: 'camp1' } })
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.logs).toEqual([{ id: 'l1', title: 'Turn 1' }])
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
