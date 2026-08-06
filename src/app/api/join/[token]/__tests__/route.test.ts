// src/app/api/join/[token]/__tests__/route.test.ts
// #135 (cont.) — joining a campaign via invite link had no test coverage:
// expiry/exhaustion checks, the ban check (which must block rejoining even
// via a still-valid link), the already-a-member short-circuit, and the
// best-effort admin notification were all unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ getUser: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({ getCampaignMembership: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaignInvite: { findUnique: vi.fn(), update: vi.fn() },
    campaignMembership: { create: vi.fn(), findMany: vi.fn() },
    user: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}))
vi.mock('@/lib/safety/safety-service', () => ({
  SafetyService: { isUserBanned: vi.fn() },
}))
vi.mock('@/lib/notifications/notification-service', () => ({
  NotificationService: { createNotification: vi.fn() },
}))

import { getUser } from '@/lib/auth'
import { getCampaignMembership } from '@/lib/db/campaignAccess'
import { prisma } from '@/lib/prisma'
import { SafetyService } from '@/lib/safety/safety-service'
import { NotificationService } from '@/lib/notifications/notification-service'
import { POST, GET } from '../route'

const db = prisma as any

function postRequest() {
  return new NextRequest('http://localhost/api/join/tok123', { method: 'POST' })
}

function getRequest() {
  return new NextRequest('http://localhost/api/join/tok123')
}

const validInvite = {
  id: 'inv1', token: 'tok123', campaignId: 'camp1',
  expiresAt: new Date(Date.now() + 60_000), maxUses: 10, uses: 2,
  campaign: { id: 'camp1', title: 'Test Campaign' },
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getUser as any).mockResolvedValue({ userId: 'newplayer1' })
  ;(SafetyService.isUserBanned as any).mockResolvedValue(false)
  ;(getCampaignMembership as any).mockResolvedValue(null)
  db.user.findUnique.mockResolvedValue({ name: 'New Player', email: 'new@example.com' })
  db.campaignMembership.findMany.mockResolvedValue([])
})

describe('POST', () => {
  it('rejects an unauthenticated request', async () => {
    ;(getUser as any).mockResolvedValue(null)
    const response = await POST(postRequest(), { params: { token: 'tok123' } })
    expect(response.status).toBe(401)
  })

  it('rejects an unknown token', async () => {
    db.campaignInvite.findUnique.mockResolvedValue(null)
    const response = await POST(postRequest(), { params: { token: 'tok123' } })
    expect(response.status).toBe(404)
  })

  it('rejects an expired invite', async () => {
    db.campaignInvite.findUnique.mockResolvedValue({ ...validInvite, expiresAt: new Date(Date.now() - 1000) })
    const response = await POST(postRequest(), { params: { token: 'tok123' } })
    expect(response.status).toBe(400)
  })

  it('rejects an exhausted invite', async () => {
    db.campaignInvite.findUnique.mockResolvedValue({ ...validInvite, maxUses: 5, uses: 5 })
    const response = await POST(postRequest(), { params: { token: 'tok123' } })
    expect(response.status).toBe(400)
  })

  it('blocks a banned user even with a still-valid invite', async () => {
    db.campaignInvite.findUnique.mockResolvedValue(validInvite)
    ;(SafetyService.isUserBanned as any).mockResolvedValue(true)
    const response = await POST(postRequest(), { params: { token: 'tok123' } })
    expect(response.status).toBe(403)
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it('short-circuits with 200 when already a member, without creating a duplicate membership', async () => {
    db.campaignInvite.findUnique.mockResolvedValue(validInvite)
    ;(getCampaignMembership as any).mockResolvedValue({ role: 'PLAYER' })
    const response = await POST(postRequest(), { params: { token: 'tok123' } })
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.message).toContain('already a member')
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it('creates the membership, increments invite uses, and notifies admins', async () => {
    db.campaignInvite.findUnique.mockResolvedValue(validInvite)
    db.$transaction.mockResolvedValue([{ id: 'membership1', userId: 'newplayer1', campaignId: 'camp1', role: 'PLAYER' }])
    db.campaignMembership.findMany.mockResolvedValue([{ userId: 'admin1' }])

    const response = await POST(postRequest(), { params: { token: 'tok123' } })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.campaignId).toBe('camp1')
    expect(NotificationService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'CAMPAIGN_INVITE', userId: 'admin1', campaignId: 'camp1' })
    )
  })

  it('does not notify the joiner themselves even if they somehow have admin role', async () => {
    db.campaignInvite.findUnique.mockResolvedValue(validInvite)
    db.$transaction.mockResolvedValue([{ id: 'membership1' }])
    db.campaignMembership.findMany.mockResolvedValue([{ userId: 'newplayer1' }])

    await POST(postRequest(), { params: { token: 'tok123' } })

    expect(NotificationService.createNotification).not.toHaveBeenCalled()
  })

  it('still succeeds even when the admin-notification step fails (best-effort)', async () => {
    db.campaignInvite.findUnique.mockResolvedValue(validInvite)
    db.$transaction.mockResolvedValue([{ id: 'membership1' }])
    db.campaignMembership.findMany.mockRejectedValue(new Error('notify lookup failed'))

    const response = await POST(postRequest(), { params: { token: 'tok123' } })

    expect(response.status).toBe(200)
  })
})

describe('GET', () => {
  it('404s for an unknown token', async () => {
    db.campaignInvite.findUnique.mockResolvedValue(null)
    const response = await GET(getRequest(), { params: { token: 'tok123' } })
    expect(response.status).toBe(404)
  })

  it('reports canJoin true for a fresh, valid invite', async () => {
    db.campaignInvite.findUnique.mockResolvedValue(validInvite)
    const response = await GET(getRequest(), { params: { token: 'tok123' } })
    const body = await response.json()
    expect(body.canJoin).toBe(true)
    expect(body.isExpired).toBe(false)
    expect(body.isExhausted).toBe(false)
  })

  it('reports canJoin false for an expired invite, without requiring auth', async () => {
    db.campaignInvite.findUnique.mockResolvedValue({ ...validInvite, expiresAt: new Date(Date.now() - 1000) })
    const response = await GET(getRequest(), { params: { token: 'tok123' } })
    const body = await response.json()
    expect(body.canJoin).toBe(false)
    expect(body.isExpired).toBe(true)
  })
})
