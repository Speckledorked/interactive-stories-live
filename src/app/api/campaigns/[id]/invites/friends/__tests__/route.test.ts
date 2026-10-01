// src/app/api/campaigns/[id]/invites/friends/__tests__/route.test.ts
//
// #507 — the friends-to-campaign bridge.
//
// The security-relevant assertions are the friendship gate and the admin
// gate. Without the first, an admin could address an invite to any user id
// and have MythOS deliver a notification to a stranger — the route would
// become an unsolicited-invite channel with the product's own name on it.
// The picker not offering a stranger is not a defence: this route is
// reachable without the picker.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ getUser: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({ requireCampaignAdmin: vi.fn() }))
vi.mock('@/lib/appUrl', () => ({ getAppUrl: () => 'https://mythos.test' }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    friendship: { findMany: vi.fn() },
    user: { findMany: vi.fn(), findUnique: vi.fn() },
    campaign: { findUnique: vi.fn() },
    campaignMembership: { findMany: vi.fn(), findFirst: vi.fn() },
    campaignInvite: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    campaignBan: { findMany: vi.fn() },
  },
}))
vi.mock('@/lib/safety/safety-service', () => ({
  SafetyService: { isUserBanned: vi.fn() },
}))
vi.mock('@/lib/notifications/notification-service', () => ({
  NotificationService: { createNotification: vi.fn() },
}))

import { getUser } from '@/lib/auth'
import { requireCampaignAdmin } from '@/lib/db/campaignAccess'
import { prisma } from '@/lib/prisma'
import { SafetyService } from '@/lib/safety/safety-service'
import { NotificationService } from '@/lib/notifications/notification-service'
import { GET, POST } from '../route'

const db = prisma as any
const params = { params: { id: 'camp1' } }

function getRequest() {
  return new NextRequest('http://localhost/api/campaigns/camp1/invites/friends')
}

function postRequest(body: unknown) {
  return new NextRequest('http://localhost/api/campaigns/camp1/invites/friends', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getUser as any).mockResolvedValue({ userId: 'gm1' })
  ;(requireCampaignAdmin as any).mockResolvedValue({ membership: { role: 'ADMIN' } })
  ;(SafetyService.isUserBanned as any).mockResolvedValue(false)
  // gm1 is friends with friend1 and friend2.
  db.friendship.findMany.mockResolvedValue([
    { user1Id: 'friend1', user2Id: 'gm1' },
    { user1Id: 'gm1', user2Id: 'friend2' },
  ])
  db.user.findMany.mockResolvedValue([
    { id: 'friend1', name: 'Ada', email: 'ada@example.com', isOnline: true },
    { id: 'friend2', name: null, email: 'bram@example.com', isOnline: false },
  ])
  db.user.findUnique.mockResolvedValue({ name: 'The GM', email: 'gm@example.com' })
  db.campaign.findUnique.mockResolvedValue({ title: 'Ashfall' })
  db.campaignMembership.findMany.mockResolvedValue([])
  db.campaignMembership.findFirst.mockResolvedValue(null)
  db.campaignInvite.findMany.mockResolvedValue([])
  db.campaignInvite.findFirst.mockResolvedValue(null)
  db.campaignInvite.create.mockImplementation(async ({ data }: any) => ({
    id: 'inv-new', token: 'tok-new', ...data,
  }))
  db.campaignBan.findMany.mockResolvedValue([])
})

describe('GET — the invite picker', () => {
  it('rejects an unauthenticated request', async () => {
    ;(getUser as any).mockResolvedValue(null)
    expect((await GET(getRequest(), params)).status).toBe(401)
  })

  it('defers to the admin gate', async () => {
    const forbidden = new Response('no', { status: 403 })
    ;(requireCampaignAdmin as any).mockResolvedValue({ response: forbidden })
    expect((await GET(getRequest(), params)).status).toBe(403)
  })

  it('falls back to the email when a friend has no display name', async () => {
    const body = await (await GET(getRequest(), params)).json()
    expect(body.friends.map((f: any) => f.name)).toEqual(['Ada', 'bram@example.com'])
  })

  it('marks a friend who is already in the campaign', async () => {
    db.campaignMembership.findMany.mockResolvedValue([{ userId: 'friend1' }])
    const body = await (await GET(getRequest(), params)).json()
    expect(body.friends.find((f: any) => f.id === 'friend1').isMember).toBe(true)
    expect(body.friends.find((f: any) => f.id === 'friend2').isMember).toBe(false)
  })

  it('marks a friend with a live unredeemed invite', async () => {
    db.campaignInvite.findMany.mockResolvedValue([{ invitedUserId: 'friend2' }])
    const body = await (await GET(getRequest(), params)).json()
    expect(body.friends.find((f: any) => f.id === 'friend2').isInvited).toBe(true)
  })

  it('only counts invites that are still live and unspent', async () => {
    // An expired or already-redeemed invite must not read as "invited" —
    // that would permanently block re-inviting someone who never answered.
    await GET(getRequest(), params)
    const where = db.campaignInvite.findMany.mock.calls[0][0].where
    expect(where.uses).toBe(0)
    expect(where.expiresAt.gt).toBeInstanceOf(Date)
  })

  it('treats an expired temporary ban as no ban', async () => {
    db.campaignBan.findMany.mockResolvedValue([
      { userId: 'friend1', isPermanent: false, expiresAt: new Date(Date.now() - 1000) },
      { userId: 'friend2', isPermanent: true, expiresAt: null },
    ])
    const body = await (await GET(getRequest(), params)).json()
    expect(body.friends.find((f: any) => f.id === 'friend1').isBanned).toBe(false)
    expect(body.friends.find((f: any) => f.id === 'friend2').isBanned).toBe(true)
  })

  it('returns an empty list, and reads nothing further, with no friends', async () => {
    db.friendship.findMany.mockResolvedValue([])
    const body = await (await GET(getRequest(), params)).json()
    expect(body.friends).toEqual([])
    expect(db.campaignMembership.findMany).not.toHaveBeenCalled()
  })
})

describe('POST — issuing an addressed invite', () => {
  it('requires a friendId', async () => {
    expect((await POST(postRequest({}), params)).status).toBe(400)
  })

  it('defers to the admin gate', async () => {
    const forbidden = new Response('no', { status: 403 })
    ;(requireCampaignAdmin as any).mockResolvedValue({ response: forbidden })
    expect((await POST(postRequest({ friendId: 'friend1' }), params)).status).toBe(403)
  })

  it('refuses to invite someone who is not a friend', async () => {
    // The gate that keeps this from being a channel for unsolicited invites.
    const response = await POST(postRequest({ friendId: 'stranger' }), params)
    expect(response.status).toBe(403)
    expect(db.campaignInvite.create).not.toHaveBeenCalled()
    expect(NotificationService.createNotification).not.toHaveBeenCalled()
  })

  it('refuses to invite a banned player', async () => {
    ;(SafetyService.isUserBanned as any).mockResolvedValue(true)
    const response = await POST(postRequest({ friendId: 'friend1' }), params)
    expect(response.status).toBe(403)
    expect(db.campaignInvite.create).not.toHaveBeenCalled()
  })

  it('refuses to invite an existing member', async () => {
    db.campaignMembership.findFirst.mockResolvedValue({ id: 'mem1' })
    const response = await POST(postRequest({ friendId: 'friend1' }), params)
    expect(response.status).toBe(409)
    expect(db.campaignInvite.create).not.toHaveBeenCalled()
  })

  it('issues a single-use invite addressed to that friend', async () => {
    const response = await POST(postRequest({ friendId: 'friend1' }), params)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(db.campaignInvite.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        campaignId: 'camp1',
        createdBy: 'gm1',
        invitedUserId: 'friend1',
        // Addressed to one person, so one use — belt and braces alongside
        // join/[token]'s own recipient check.
        maxUses: 1,
      }),
    })
    expect(body.joinUrl).toBe('https://mythos.test/join/tok-new')
  })

  it('delivers the invite in-app, pointing at the join link', async () => {
    await POST(postRequest({ friendId: 'friend1' }), params)
    expect(NotificationService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'CAMPAIGN_INVITE',
        userId: 'friend1',
        campaignId: 'camp1',
        actionUrl: '/join/tok-new',
      })
    )
  })

  it('reuses a live unredeemed invite instead of stacking a second one', async () => {
    // Inviting twice when the first went unanswered is normal, and must not
    // leave two valid tokens and two notifications.
    db.campaignInvite.findFirst.mockResolvedValue({
      id: 'inv-old', token: 'tok-old', expiresAt: new Date(Date.now() + 60_000),
    })

    const body = await (await POST(postRequest({ friendId: 'friend1' }), params)).json()

    expect(db.campaignInvite.create).not.toHaveBeenCalled()
    expect(body.reused).toBe(true)
    expect(body.joinUrl).toBe('https://mythos.test/join/tok-old')
    // Still re-notified: the point of inviting again is the nudge.
    expect(NotificationService.createNotification).toHaveBeenCalled()
  })

  it('still reports success when the notification fails', async () => {
    // The invite exists and the inviter can see it; failing the request
    // would claim no invite was issued when one was.
    ;(NotificationService.createNotification as any).mockRejectedValue(new Error('smtp down'))
    const response = await POST(postRequest({ friendId: 'friend1' }), params)
    expect(response.status).toBe(200)
  })

  it('404s on a campaign that does not exist', async () => {
    db.campaign.findUnique.mockResolvedValue(null)
    expect((await POST(postRequest({ friendId: 'friend1' }), params)).status).toBe(404)
  })
})
