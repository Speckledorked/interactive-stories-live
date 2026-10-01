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
    campaignInvite: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
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

// #507: the route moved from $transaction([ops]) to the interactive form,
// because the use-claim's outcome now decides whether the membership is
// written at all. The array form cannot express that.
//
// The mock runs the callback against the SAME model mocks the route would
// otherwise use, so every assertion in this file about what gets written
// keeps working — and keeps working for the reason the #399 comment below
// gives: an opaque $transaction makes its operations unobservable, and
// tests then assert THAT it ran instead of WHAT it did. Swapping one opaque
// mock for another would have quietly re-opened exactly that hole.
function runTransactionsForReal() {
  db.$transaction.mockImplementation(async (arg: any) =>
    typeof arg === 'function' ? arg(db) : Promise.all(arg)
  )
}

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
  // Default: the claim succeeds. A test that wants the lost race says so.
  db.campaignInvite.updateMany.mockResolvedValue({ count: 1 })
  runTransactionsForReal()
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
    expect(db.campaignMembership.create).not.toHaveBeenCalled()
  })

  it('short-circuits with 200 when already a member, without creating a duplicate membership', async () => {
    db.campaignInvite.findUnique.mockResolvedValue(validInvite)
    ;(getCampaignMembership as any).mockResolvedValue({ role: 'PLAYER' })
    const response = await POST(postRequest(), { params: { token: 'tok123' } })
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.message).toContain('already a member')
    expect(db.campaignMembership.create).not.toHaveBeenCalled()
  })

  it('creates the membership, increments invite uses, and notifies admins', async () => {
    db.campaignInvite.findUnique.mockResolvedValue(validInvite)
    db.campaignMembership.findMany.mockResolvedValue([{ userId: 'admin1' }])

    const response = await POST(postRequest(), { params: { token: 'tok123' } })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.campaignId).toBe('camp1')
    expect(NotificationService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'CAMPAIGN_INVITE', userId: 'admin1', campaignId: 'camp1' })
    )
  })

  // #399: what this route WRITES, asserted.
  //
  // $transaction was mocked as a bare vi.fn() and every existing test
  // asserted only that it was or wasn't called — so `role: 'PLAYER'` in
  // the route was asserted by NO test in 325 test files. Changing it to
  // 'ADMIN' passed CI, and every invite link in the product became a
  // privilege escalation. `increment: 1` had the same hole: flipping it to
  // `decrement: 1` makes every invite infinitely reusable, silently.
  //
  // The general lesson is about the mock, not this route: an opaque
  // $transaction makes the operations it wraps unobservable, so tests
  // naturally end up asserting THAT it was called rather than WHAT it was
  // asked to do — and the highest-blast-radius write path in the product
  // happened to sit behind exactly that mock.
  it('grants PLAYER, never a role the caller could pick or inherit', async () => {
    db.campaignInvite.findUnique.mockResolvedValue(validInvite)
    db.campaignMembership.findMany.mockResolvedValue([])

    await POST(postRequest(), { params: { token: 'tok123' } })

    expect(db.campaignMembership.create).toHaveBeenCalledWith({
      data: { userId: 'newplayer1', campaignId: 'camp1', role: 'PLAYER' },
    })
  })

  it('increments the invite use count rather than decrementing it', async () => {
    db.campaignInvite.findUnique.mockResolvedValue(validInvite)
    db.campaignMembership.findMany.mockResolvedValue([])

    await POST(postRequest(), { params: { token: 'tok123' } })

    // A capped invite claims its seat with a compare-and-set on the `uses`
    // value this request read — see the route. Decrementing here would make
    // every capped invite infinitely reusable, as silently as before.
    expect(db.campaignInvite.updateMany).toHaveBeenCalledWith({
      where: { id: validInvite.id, uses: validInvite.uses },
      data: { uses: { increment: 1 } },
    })
  })

  it('increments plainly, with no compare-and-set, on an uncapped invite', async () => {
    // maxUses 0 has nothing to race over — the counter is a statistic, not
    // a gate — and must not serialise every join behind a claim.
    db.campaignInvite.findUnique.mockResolvedValue({ ...validInvite, maxUses: 0, uses: 7 })
    db.campaignMembership.findMany.mockResolvedValue([])

    await POST(postRequest(), { params: { token: 'tok123' } })

    expect(db.campaignInvite.updateMany).not.toHaveBeenCalled()
    expect(db.campaignInvite.update).toHaveBeenCalledWith({
      where: { id: validInvite.id },
      data: { uses: { increment: 1 } },
    })
    expect(db.campaignMembership.create).toHaveBeenCalled()
  })

  it('performs both writes inside ONE transaction', async () => {
    // A membership created without the use count moving is a
    // permanently-reusable invite; a use count moving without a membership
    // is a burned invite that granted nothing.
    db.campaignInvite.findUnique.mockResolvedValue(validInvite)
    db.campaignMembership.findMany.mockResolvedValue([])

    await POST(postRequest(), { params: { token: 'tok123' } })

    expect(db.$transaction).toHaveBeenCalledTimes(1)
    // Interactive form: one callback carrying both writes, rather than two
    // independent operations that cannot branch on each other.
    expect(typeof db.$transaction.mock.calls[0][0]).toBe('function')
  })

  it('creates no membership when another request claimed the last seat first', async () => {
    // The race the compare-and-set exists for: both requests read uses: 4
    // of 5 and both passed the early check, so the loser must be refused
    // HERE, not handed a seat that no longer exists.
    db.campaignInvite.findUnique.mockResolvedValue({ ...validInvite, maxUses: 5, uses: 4 })
    db.campaignInvite.updateMany.mockResolvedValue({ count: 0 })

    const response = await POST(postRequest(), { params: { token: 'tok123' } })

    expect(response.status).toBe(400)
    expect(db.campaignMembership.create).not.toHaveBeenCalled()
  })

  it('does not notify the joiner themselves even if they somehow have admin role', async () => {
    db.campaignInvite.findUnique.mockResolvedValue(validInvite)
    db.campaignMembership.findMany.mockResolvedValue([{ userId: 'newplayer1' }])

    await POST(postRequest(), { params: { token: 'tok123' } })

    expect(NotificationService.createNotification).not.toHaveBeenCalled()
  })

  // #507: addressed invites.
  it('refuses an addressed invite presented by anyone but its recipient', async () => {
    db.campaignInvite.findUnique.mockResolvedValue({ ...validInvite, invitedUserId: 'someone-else' })

    const response = await POST(postRequest(), { params: { token: 'tok123' } })

    expect(response.status).toBe(403)
    expect(db.campaignMembership.create).not.toHaveBeenCalled()
    expect(db.campaignInvite.updateMany).not.toHaveBeenCalled()
  })

  it('checks the recipient before the ban and membership lookups', async () => {
    // Order matters for disclosure, not just efficiency: a stranger holding
    // a leaked token must not be able to tell from the error whether they
    // are banned from, or already in, a campaign they were never invited to.
    db.campaignInvite.findUnique.mockResolvedValue({ ...validInvite, invitedUserId: 'someone-else' })

    await POST(postRequest(), { params: { token: 'tok123' } })

    expect(SafetyService.isUserBanned).not.toHaveBeenCalled()
    expect(getCampaignMembership).not.toHaveBeenCalled()
  })

  it('lets the named recipient redeem their own addressed invite', async () => {
    db.campaignInvite.findUnique.mockResolvedValue({
      ...validInvite, invitedUserId: 'newplayer1', maxUses: 1, uses: 0,
    })
    db.campaignMembership.findMany.mockResolvedValue([])

    const response = await POST(postRequest(), { params: { token: 'tok123' } })

    expect(response.status).toBe(200)
    expect(db.campaignMembership.create).toHaveBeenCalledWith({
      data: { userId: 'newplayer1', campaignId: 'camp1', role: 'PLAYER' },
    })
  })

  it('still applies the ban check to the named recipient', async () => {
    // Being invited is not an exemption: a GM who banned someone and then
    // forgot an outstanding invite must not have it let them back in.
    db.campaignInvite.findUnique.mockResolvedValue({ ...validInvite, invitedUserId: 'newplayer1' })
    ;(SafetyService.isUserBanned as any).mockResolvedValue(true)

    const response = await POST(postRequest(), { params: { token: 'tok123' } })

    expect(response.status).toBe(403)
    expect(db.campaignMembership.create).not.toHaveBeenCalled()
  })

  it('still succeeds even when the admin-notification step fails (best-effort)', async () => {
    db.campaignInvite.findUnique.mockResolvedValue(validInvite)
    db.campaignMembership.findMany.mockRejectedValue(new Error('notify lookup failed'))

    const response = await POST(postRequest(), { params: { token: 'tok123' } })

    expect(response.status).toBe(200)
  })
})

describe('GET', () => {
  it('reports an addressed invite without naming its recipient', async () => {
    db.campaignInvite.findUnique.mockResolvedValue({
      ...validInvite, invitedUserId: 'friend1',
      campaign: { id: 'camp1', title: 'Test Campaign', description: null, universe: null },
    })

    const response = await GET(getRequest(), { params: { token: 'tok123' } })
    const body = await response.json()

    expect(body.isAddressed).toBe(true)
    // This route is unauthenticated. Saying WHO an invite is for would turn
    // any leaked token into a lookup for that person's id.
    expect(JSON.stringify(body)).not.toContain('friend1')
  })

  it('reports a link invite as not addressed', async () => {
    db.campaignInvite.findUnique.mockResolvedValue({
      ...validInvite, invitedUserId: null,
      campaign: { id: 'camp1', title: 'Test Campaign', description: null, universe: null },
    })

    const response = await GET(getRequest(), { params: { token: 'tok123' } })
    expect((await response.json()).isAddressed).toBe(false)
  })

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
