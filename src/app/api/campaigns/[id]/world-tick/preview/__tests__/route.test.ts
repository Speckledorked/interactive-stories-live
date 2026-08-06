// src/app/api/campaigns/[id]/world-tick/preview/__tests__/route.test.ts
// #135 (cont.) — the admin-only world-tick dry-run preview had no test
// coverage: the admin gate, and that dryRun:true is actually passed
// through to runWorldTick (the one thing standing between this route and
// mutating real campaign state), were both unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ getUser: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({ requireCampaignAdmin: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { worldMeta: { findUnique: vi.fn() } },
}))
vi.mock('@/lib/game/worldTick', () => ({ runWorldTick: vi.fn() }))

import { getUser } from '@/lib/auth'
import { requireCampaignAdmin } from '@/lib/db/campaignAccess'
import { prisma } from '@/lib/prisma'
import { runWorldTick } from '@/lib/game/worldTick'
import { POST } from '../route'

const db = prisma as any

function req() {
  return new NextRequest('http://localhost/api/campaigns/camp1/world-tick/preview', { method: 'POST' })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getUser as any).mockResolvedValue({ userId: 'admin1' })
  ;(requireCampaignAdmin as any).mockResolvedValue({ membership: { role: 'ADMIN' } })
})

describe('POST', () => {
  it('rejects an unauthenticated request', async () => {
    ;(getUser as any).mockResolvedValue(null)
    const response = await POST(req(), { params: { id: 'camp1' } })
    expect(response.status).toBe(401)
    expect(runWorldTick).not.toHaveBeenCalled()
  })

  it('rejects a non-admin', async () => {
    ;(requireCampaignAdmin as any).mockResolvedValue({ response: new Response(null, { status: 403 }) })
    const response = await POST(req(), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
    expect(runWorldTick).not.toHaveBeenCalled()
  })

  it('404s when the campaign has no world state yet', async () => {
    db.worldMeta.findUnique.mockResolvedValue(null)
    const response = await POST(req(), { params: { id: 'camp1' } })
    expect(response.status).toBe(404)
    expect(runWorldTick).not.toHaveBeenCalled()
  })

  it('previews the tick with dryRun:true, never mutating real state', async () => {
    db.worldMeta.findUnique.mockResolvedValue({ currentTurnNumber: 5 })
    ;(runWorldTick as any).mockResolvedValue({ turnNumber: 6, changes: [{ entityType: 'FACTION' }] })

    const response = await POST(req(), { params: { id: 'camp1' } })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(runWorldTick).toHaveBeenCalledWith('camp1', 5, { dryRun: true })
    expect(body).toEqual({ turnNumber: 6, changes: [{ entityType: 'FACTION' }] })
  })

  it('returns 500 on an unexpected error', async () => {
    db.worldMeta.findUnique.mockRejectedValue(new Error('db down'))
    const response = await POST(req(), { params: { id: 'camp1' } })
    expect(response.status).toBe(500)
  })
})
