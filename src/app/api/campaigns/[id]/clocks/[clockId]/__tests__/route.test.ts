// src/app/api/campaigns/[id]/clocks/[clockId]/__tests__/route.test.ts
// #135 (cont.) — updating and ticking a clock had no test coverage: the
// admin gate, tick/untick clamping at 0 and maxTicks, and that a hidden
// clock's update/tick never broadcasts (a GM-only clock leaking its
// existence via a Pusher event would defeat the point of hiding it) were
// all unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ getUser: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({ requireCampaignAdmin: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { clock: { update: vi.fn(), findUnique: vi.fn() } },
}))
vi.mock('@/lib/realtime/pusher-server', () => ({ PusherServer: vi.fn() }))

import { getUser } from '@/lib/auth'
import { requireCampaignAdmin } from '@/lib/db/campaignAccess'
import { prisma } from '@/lib/prisma'
import { PusherServer } from '@/lib/realtime/pusher-server'
import { PATCH, POST } from '../route'

const db = prisma as any

function patchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/campaigns/camp1/clocks/clock1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function tickRequest(action: string) {
  return new NextRequest('http://localhost/api/campaigns/camp1/clocks/clock1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getUser as any).mockResolvedValue({ userId: 'admin1' })
  ;(requireCampaignAdmin as any).mockResolvedValue({ membership: { role: 'ADMIN' } })
  ;(PusherServer as any).mockReturnValue(null)
})

describe('PATCH', () => {
  it('rejects a non-admin', async () => {
    ;(requireCampaignAdmin as any).mockResolvedValue({ response: new Response(null, { status: 403 }) })
    const response = await PATCH(patchRequest({ name: 'New' }), { params: { id: 'camp1', clockId: 'clock1' } })
    expect(response.status).toBe(403)
    expect(db.clock.update).not.toHaveBeenCalled()
  })

  it('broadcasts the update for a visible clock', async () => {
    const trigger = vi.fn().mockResolvedValue(undefined)
    ;(PusherServer as any).mockReturnValue({ trigger })
    db.clock.update.mockResolvedValue({ id: 'clock1', name: 'Doom Clock', currentTicks: 2, maxTicks: 6, isHidden: false })

    const response = await PATCH(patchRequest({ name: 'Doom Clock' }), { params: { id: 'camp1', clockId: 'clock1' } })

    expect(response.status).toBe(200)
    expect(trigger).toHaveBeenCalledWith('campaign-camp1', 'clock:updated', expect.objectContaining({ clockId: 'clock1' }))
  })

  it('does not broadcast an update for a hidden clock', async () => {
    const trigger = vi.fn()
    ;(PusherServer as any).mockReturnValue({ trigger })
    db.clock.update.mockResolvedValue({ id: 'clock1', name: 'Secret Clock', isHidden: true })

    await PATCH(patchRequest({ isHidden: true }), { params: { id: 'camp1', clockId: 'clock1' } })

    expect(trigger).not.toHaveBeenCalled()
  })

  it('returns 500 on an unexpected error', async () => {
    db.clock.update.mockRejectedValue(new Error('db down'))
    const response = await PATCH(patchRequest({ name: 'New' }), { params: { id: 'camp1', clockId: 'clock1' } })
    expect(response.status).toBe(500)
  })
})

describe('POST (tick/untick)', () => {
  it('rejects a non-admin', async () => {
    ;(requireCampaignAdmin as any).mockResolvedValue({ response: new Response(null, { status: 403 }) })
    const response = await POST(tickRequest('tick'), { params: { id: 'camp1', clockId: 'clock1' } })
    expect(response.status).toBe(403)
  })

  it('404s when the clock does not exist', async () => {
    db.clock.findUnique.mockResolvedValue(null)
    const response = await POST(tickRequest('tick'), { params: { id: 'camp1', clockId: 'clock1' } })
    expect(response.status).toBe(404)
  })

  it('increments on tick', async () => {
    db.clock.findUnique.mockResolvedValue({ id: 'clock1', currentTicks: 2, maxTicks: 6, isHidden: false, name: 'Doom', consequence: null })
    db.clock.update.mockResolvedValue({ id: 'clock1', currentTicks: 3, maxTicks: 6, isHidden: false, name: 'Doom' })

    const response = await POST(tickRequest('tick'), { params: { id: 'camp1', clockId: 'clock1' } })

    expect(response.status).toBe(200)
    expect(db.clock.update).toHaveBeenCalledWith({ where: { id: 'clock1' }, data: { currentTicks: 3 } })
  })

  it('does not tick past maxTicks', async () => {
    db.clock.findUnique.mockResolvedValue({ id: 'clock1', currentTicks: 6, maxTicks: 6, isHidden: false, name: 'Doom', consequence: null })
    db.clock.update.mockResolvedValue({ id: 'clock1', currentTicks: 6, maxTicks: 6, isHidden: false, name: 'Doom' })

    await POST(tickRequest('tick'), { params: { id: 'camp1', clockId: 'clock1' } })

    expect(db.clock.update).toHaveBeenCalledWith({ where: { id: 'clock1' }, data: { currentTicks: 6 } })
  })

  it('decrements on untick, never below 0', async () => {
    db.clock.findUnique.mockResolvedValue({ id: 'clock1', currentTicks: 0, maxTicks: 6, isHidden: false, name: 'Doom', consequence: null })
    db.clock.update.mockResolvedValue({ id: 'clock1', currentTicks: 0, maxTicks: 6, isHidden: false, name: 'Doom' })

    await POST(tickRequest('untick'), { params: { id: 'camp1', clockId: 'clock1' } })

    expect(db.clock.update).toHaveBeenCalledWith({ where: { id: 'clock1' }, data: { currentTicks: 0 } })
  })

  it('does not broadcast a tick for a hidden clock', async () => {
    const trigger = vi.fn()
    ;(PusherServer as any).mockReturnValue({ trigger })
    db.clock.findUnique.mockResolvedValue({ id: 'clock1', currentTicks: 2, maxTicks: 6, isHidden: true, name: 'Secret', consequence: null })
    db.clock.update.mockResolvedValue({ id: 'clock1', currentTicks: 3, maxTicks: 6, isHidden: true, name: 'Secret' })

    await POST(tickRequest('tick'), { params: { id: 'camp1', clockId: 'clock1' } })

    expect(trigger).not.toHaveBeenCalled()
  })
})

// #426, found by mutation audit: flipping this route's `status: 401` to
// `status: 200` did not fail a single test, because no test ever set
// getUser to null. The unauthenticated branch — the most basic guarantee
// the route makes — was never executed. Every other assertion in this file
// runs as a signed-in user, so the 401 was structurally unreachable by the
// suite that was said to cover it.
describe('unauthenticated access (#426)', () => {
  it('rejects a caller with no session', async () => {
    ;(getUser as any).mockResolvedValue(null)

    const response = await PATCH(patchRequest({ name: 'New' }), { params: { id: 'camp1', clockId: 'clock1' } })

    expect(response.status).toBe(401)
  })
})
