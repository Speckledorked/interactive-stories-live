// src/app/api/campaigns/[id]/settings/simulation/__tests__/route.test.ts
// #96 — this route gained sceneImageGenerationEnabled alongside the
// existing mapGenerationEnabled toggle; previously untested entirely.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    worldMeta: { findUnique: vi.fn(), update: vi.fn() },
    campaign: { findUnique: vi.fn(), update: vi.fn() },
  },
}))
vi.mock('@/lib/auth', () => ({ getUser: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({
  getCampaignMembership: vi.fn(),
  requireCampaignAdmin: vi.fn(),
}))

import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { getCampaignMembership, requireCampaignAdmin } from '@/lib/db/campaignAccess'
import { GET, PATCH } from '../route'
import { MAX_FACTION_CAP, MAX_NPC_CAP } from '@/lib/game/tick/caps'

const db = prisma as any

function getRequest() {
  return new NextRequest('http://localhost/api/campaigns/camp1/settings/simulation')
}

function patchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/campaigns/camp1/settings/simulation', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getUser as any).mockResolvedValue({ userId: 'user1', email: 'user1@example.com' })
  ;(getCampaignMembership as any).mockResolvedValue({ role: 'PLAYER' })
  ;(requireCampaignAdmin as any).mockResolvedValue({ membership: { role: 'ADMIN' } })
})

describe('GET', () => {
  it('rejects a non-member', async () => {
    ;(getCampaignMembership as any).mockResolvedValue(null)
    const response = await GET(getRequest(), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
  })

  it('returns both generation toggles, defaulting to false with no campaign row', async () => {
    db.worldMeta.findUnique.mockResolvedValue(null)
    db.campaign.findUnique.mockResolvedValue(null)

    const response = await GET(getRequest(), { params: { id: 'camp1' } })
    const body = await response.json()

    expect(body.mapGenerationEnabled).toBe(false)
    expect(body.sceneImageGenerationEnabled).toBe(false)
  })

  it('returns the real toggle values when set', async () => {
    db.worldMeta.findUnique.mockResolvedValue({ factionCap: 10, npcCap: 20, worldTurnHours: 24 })
    db.campaign.findUnique.mockResolvedValue({ mapGenerationEnabled: true, sceneImageGenerationEnabled: true })

    const response = await GET(getRequest(), { params: { id: 'camp1' } })
    const body = await response.json()

    expect(body.mapGenerationEnabled).toBe(true)
    expect(body.sceneImageGenerationEnabled).toBe(true)
  })
})

describe('PATCH', () => {
  it('rejects a non-admin', async () => {
    ;(requireCampaignAdmin as any).mockResolvedValue({ response: new Response(null, { status: 403 }) })
    const response = await PATCH(patchRequest({ sceneImageGenerationEnabled: true }), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
    expect(db.campaign.update).not.toHaveBeenCalled()
  })

  it('rejects a non-boolean sceneImageGenerationEnabled', async () => {
    const response = await PATCH(patchRequest({ sceneImageGenerationEnabled: 'yes' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(400)
    expect(db.campaign.update).not.toHaveBeenCalled()
  })

  it('updates sceneImageGenerationEnabled independently of mapGenerationEnabled', async () => {
    db.campaign.update.mockResolvedValue({ mapGenerationEnabled: false, sceneImageGenerationEnabled: true })
    db.worldMeta.update.mockResolvedValue({ factionCap: null, npcCap: null, worldTurnHours: null })

    const response = await PATCH(patchRequest({ sceneImageGenerationEnabled: true }), { params: { id: 'camp1' } })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(db.campaign.update).toHaveBeenCalledWith({
      where: { id: 'camp1' },
      data: { sceneImageGenerationEnabled: true },
      select: { mapGenerationEnabled: true, sceneImageGenerationEnabled: true },
    })
    expect(body.sceneImageGenerationEnabled).toBe(true)
  })

  it('updates both toggles together in one call when both are provided', async () => {
    db.campaign.update.mockResolvedValue({ mapGenerationEnabled: true, sceneImageGenerationEnabled: true })
    db.worldMeta.update.mockResolvedValue({ factionCap: null, npcCap: null, worldTurnHours: null })

    await PATCH(patchRequest({ mapGenerationEnabled: true, sceneImageGenerationEnabled: true }), { params: { id: 'camp1' } })

    expect(db.campaign.update).toHaveBeenCalledWith({
      where: { id: 'camp1' },
      data: { mapGenerationEnabled: true, sceneImageGenerationEnabled: true },
      select: { mapGenerationEnabled: true, sceneImageGenerationEnabled: true },
    })
  })

  it('does not touch the campaign row at all when neither toggle is provided', async () => {
    db.campaign.findUnique.mockResolvedValue({ mapGenerationEnabled: false, sceneImageGenerationEnabled: false })
    db.worldMeta.update.mockResolvedValue({ factionCap: 5, npcCap: null, worldTurnHours: null })

    await PATCH(patchRequest({ factionCap: 5 }), { params: { id: 'camp1' } })

    expect(db.campaign.update).not.toHaveBeenCalled()
    expect(db.campaign.findUnique).toHaveBeenCalled()
  })

  // #203: factionCap/npcCap feed every tick handler's per-turn roster size,
  // and the real (non-dry-run) tick wraps every handler in one transaction
  // with a flat timeout that does NOT scale with these caps — an
  // unbounded admin-settable cap could eventually blow that budget.
  describe('factionCap/npcCap upper bound (#203)', () => {
    it('rejects a factionCap above MAX_FACTION_CAP', async () => {
      const response = await PATCH(patchRequest({ factionCap: MAX_FACTION_CAP + 1 }), { params: { id: 'camp1' } })
      expect(response.status).toBe(400)
      expect(db.worldMeta.update).not.toHaveBeenCalled()
    })

    it('rejects an npcCap above MAX_NPC_CAP', async () => {
      const response = await PATCH(patchRequest({ npcCap: MAX_NPC_CAP + 1 }), { params: { id: 'camp1' } })
      expect(response.status).toBe(400)
      expect(db.worldMeta.update).not.toHaveBeenCalled()
    })

    it('accepts a factionCap/npcCap exactly at the max', async () => {
      db.worldMeta.update.mockResolvedValue({ factionCap: MAX_FACTION_CAP, npcCap: MAX_NPC_CAP, worldTurnHours: null })
      db.campaign.findUnique.mockResolvedValue({ mapGenerationEnabled: false, sceneImageGenerationEnabled: false })

      const response = await PATCH(
        patchRequest({ factionCap: MAX_FACTION_CAP, npcCap: MAX_NPC_CAP }),
        { params: { id: 'camp1' } }
      )

      expect(response.status).toBe(200)
      expect(db.worldMeta.update).toHaveBeenCalled()
    })

    it('does not clamp worldTurnHours, which has no relationship to the tick timeout', async () => {
      db.worldMeta.update.mockResolvedValue({ factionCap: null, npcCap: null, worldTurnHours: 999 })
      db.campaign.findUnique.mockResolvedValue({ mapGenerationEnabled: false, sceneImageGenerationEnabled: false })

      const response = await PATCH(patchRequest({ worldTurnHours: 999 }), { params: { id: 'camp1' } })

      expect(response.status).toBe(200)
    })

    it('allows clearing a cap back to null regardless of the max', async () => {
      db.worldMeta.update.mockResolvedValue({ factionCap: null, npcCap: null, worldTurnHours: null })
      db.campaign.findUnique.mockResolvedValue({ mapGenerationEnabled: false, sceneImageGenerationEnabled: false })

      const response = await PATCH(patchRequest({ factionCap: null, npcCap: null }), { params: { id: 'camp1' } })

      expect(response.status).toBe(200)
    })
  })
})
