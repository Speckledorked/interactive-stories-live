// src/app/api/campaigns/[id]/block/__tests__/route.test.ts
// #93 — untested despite feeding the message-visibility filter elsewhere;
// also the one route in this batch with a real P2002-specific error branch
// worth pinning (a double-block must read as "already blocked", not a 500).

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({ getCampaignMembership: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { userBlock: { findMany: vi.fn() } },
}))
vi.mock('@/lib/safety/safety-service', () => ({
  SafetyService: { blockUser: vi.fn(), unblockUser: vi.fn() },
}))

import { requireAuth } from '@/lib/auth'
import { getCampaignMembership } from '@/lib/db/campaignAccess'
import { prisma } from '@/lib/prisma'
import { SafetyService } from '@/lib/safety/safety-service'
import { POST, DELETE, GET } from '../route'

const db = prisma as any

function postRequest(body: unknown) {
  return new NextRequest('http://localhost/api/campaigns/camp1/block', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function deleteRequest(blockedUserId?: string) {
  const url = blockedUserId
    ? `http://localhost/api/campaigns/camp1/block?blockedUserId=${blockedUserId}`
    : 'http://localhost/api/campaigns/camp1/block'
  return new NextRequest(url, { method: 'DELETE' })
}

function getRequest() {
  return new NextRequest('http://localhost/api/campaigns/camp1/block')
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(requireAuth as any).mockResolvedValue({ userId: 'user1', email: 'user1@example.com' })
  ;(getCampaignMembership as any).mockResolvedValue({ role: 'PLAYER' })
})

describe('POST', () => {
  it('rejects a non-member', async () => {
    ;(getCampaignMembership as any).mockResolvedValue(null)
    const response = await POST(postRequest({ blockedUserId: 'user2' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
    expect(SafetyService.blockUser).not.toHaveBeenCalled()
  })

  it('requires blockedUserId', async () => {
    const response = await POST(postRequest({}), { params: { id: 'camp1' } })
    expect(response.status).toBe(400)
    expect(SafetyService.blockUser).not.toHaveBeenCalled()
  })

  it('refuses to let a user block themselves', async () => {
    const response = await POST(postRequest({ blockedUserId: 'user1' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(400)
    expect(SafetyService.blockUser).not.toHaveBeenCalled()
  })

  it('blocks another user, truncating an overlong reason', async () => {
    ;(SafetyService.blockUser as any).mockResolvedValue({ id: 'block1' })
    const longReason = 'x'.repeat(600)

    await POST(postRequest({ blockedUserId: 'user2', reason: longReason }), { params: { id: 'camp1' } })

    expect(SafetyService.blockUser).toHaveBeenCalledWith('user1', 'user2', 'camp1', 'x'.repeat(500))
  })

  it('reads a P2002 unique-constraint violation as "already blocked", not a generic 500', async () => {
    const conflict: any = new Error('Unique constraint failed')
    conflict.code = 'P2002'
    ;(SafetyService.blockUser as any).mockRejectedValue(conflict)

    const response = await POST(postRequest({ blockedUserId: 'user2' }), { params: { id: 'camp1' } })

    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.error).toBe('Already blocked')
  })

  it('returns a generic 500 for an unrelated failure', async () => {
    ;(SafetyService.blockUser as any).mockRejectedValue(new Error('db exploded'))
    const response = await POST(postRequest({ blockedUserId: 'user2' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(500)
  })
})

describe('DELETE', () => {
  it('requires blockedUserId as a query param', async () => {
    const response = await DELETE(deleteRequest(), { params: { id: 'camp1' } })
    expect(response.status).toBe(400)
    expect(SafetyService.unblockUser).not.toHaveBeenCalled()
  })

  it('unblocks the target user', async () => {
    const response = await DELETE(deleteRequest('user2'), { params: { id: 'camp1' } })
    expect(response.status).toBe(200)
    expect(SafetyService.unblockUser).toHaveBeenCalledWith('user1', 'user2', 'camp1')
  })
})

describe('GET', () => {
  it('rejects a non-member', async () => {
    ;(getCampaignMembership as any).mockResolvedValue(null)
    const response = await GET(getRequest(), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
  })

  it('lists only this user\'s own blocked ids', async () => {
    db.userBlock.findMany.mockResolvedValue([{ blockedUserId: 'user2' }, { blockedUserId: 'user3' }])
    const response = await GET(getRequest(), { params: { id: 'camp1' } })
    const body = await response.json()
    expect(body.blockedUserIds).toEqual(['user2', 'user3'])
    expect(db.userBlock.findMany).toHaveBeenCalledWith({
      where: { userId: 'user1', campaignId: 'camp1' },
      select: { blockedUserId: true },
    })
  })
})
