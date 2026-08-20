// src/app/api/campaigns/[id]/world-extras/__tests__/route.test.ts
// #135 (cont.) — the archetype/corruption-theme backfill had no test
// coverage: the admin gate, the rate limit, the idempotence guard (a
// campaign that already has both must be told so rather than silently
// re-rolling and orphaning characters already built from the old cards),
// and that a failed generation degrades to a clean 502 rather than
// crashing on `extras.archetypes`, were all unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ getUser: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({ requireCampaignAdmin: vi.fn() }))
vi.mock('@/lib/rateLimit', () => ({
  AI_ACTION_LIMIT: { bucket: 'ai-action', limit: 20, windowSeconds: 60 },
  checkRateLimit: vi.fn(),
  rateLimitExceededResponse: vi.fn(),
}))
vi.mock('@/lib/ai/worldExtras', () => ({ generateWorldExtras: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: { findUnique: vi.fn(), update: vi.fn() },
    faction: { findMany: vi.fn() },
    campaignCapability: { findMany: vi.fn(), updateMany: vi.fn() },
    campaignArchetype: { count: vi.fn(), createMany: vi.fn() },
  },
}))

import { getUser } from '@/lib/auth'
import { requireCampaignAdmin } from '@/lib/db/campaignAccess'
import { checkRateLimit, rateLimitExceededResponse } from '@/lib/rateLimit'
import { generateWorldExtras } from '@/lib/ai/worldExtras'
import { prisma } from '@/lib/prisma'
import { POST } from '../route'

const db = prisma as any

function req() {
  return new NextRequest('http://localhost/api/campaigns/camp1/world-extras', { method: 'POST' })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getUser as any).mockResolvedValue({ userId: 'admin1' })
  ;(requireCampaignAdmin as any).mockResolvedValue({ membership: { role: 'ADMIN' } })
  ;(checkRateLimit as any).mockResolvedValue({ allowed: true })
  db.campaign.findUnique.mockResolvedValue({
    id: 'camp1', title: 'T', description: 'd', universe: 'Original', statLabels: null, corruptionTheme: null,
  })
  db.faction.findMany.mockResolvedValue([])
  db.campaignCapability.findMany.mockResolvedValue([])
  db.campaignArchetype.count.mockResolvedValue(0)
})

describe('POST', () => {
  it('rejects an unauthenticated request', async () => {
    ;(getUser as any).mockResolvedValue(null)
    const response = await POST(req(), { params: { id: 'camp1' } })
    expect(response.status).toBe(401)
  })

  it('rejects a non-admin', async () => {
    ;(requireCampaignAdmin as any).mockResolvedValue({ response: new Response(null, { status: 403 }) })
    const response = await POST(req(), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
  })

  it('is rate limited', async () => {
    ;(checkRateLimit as any).mockResolvedValue({ allowed: false, retryAfterSeconds: 5 })
    ;(rateLimitExceededResponse as any).mockReturnValue(new Response(null, { status: 429 }))
    const response = await POST(req(), { params: { id: 'camp1' } })
    expect(response.status).toBe(429)
  })

  it('returns 404 for a missing campaign', async () => {
    db.campaign.findUnique.mockResolvedValue(null)
    const response = await POST(req(), { params: { id: 'camp1' } })
    expect(response.status).toBe(404)
  })

  it('refuses to re-roll a campaign that already has everything', async () => {
    db.campaignArchetype.count.mockResolvedValue(4)
    db.campaign.findUnique.mockResolvedValue({
      id: 'camp1', title: 'T', description: 'd', universe: 'Original', statLabels: null,
      corruptionTheme: { name: 'The Rot' },
      advancementTrack: { tiers: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }], slotGroups: [] },
    })
    const response = await POST(req(), { params: { id: 'camp1' } })
    expect(response.status).toBe(409)
    expect(generateWorldExtras).not.toHaveBeenCalled()
  })

  it('still runs for a campaign that has archetypes and a theme but no track', async () => {
    // This case used to 409. The guard hardcoded archetypes + corruption
    // theme, so when the advancement track became a third backfillable
    // field the route refused before it could ever fill one — locking out
    // exactly the long-running campaigns most likely to want it, from the
    // route whose purpose is to undo that lock-out.
    db.campaignArchetype.count.mockResolvedValue(4)
    db.campaign.findUnique.mockResolvedValue({
      id: 'camp1', title: 'T', description: 'd', universe: 'Original', statLabels: null,
      corruptionTheme: { name: 'The Rot' },
      advancementTrack: null,
    })
    ;(generateWorldExtras as any).mockResolvedValue({
      archetypes: [],
      corruptionTheme: { name: 'Ignored' },
      advancementTrack: { tiers: [{ key: 'initiate', label: 'Initiate' }, { key: 'adept', label: 'Adept' }], slotGroups: [] },
    })
    const response = await POST(req(), { params: { id: 'camp1' } })
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.advancementTrackSet).toBe(true)
    expect(db.campaign.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'camp1' },
      data: { advancementTrack: expect.objectContaining({ tiers: expect.any(Array) }) },
    }))
    // The theme it already had is left alone — this is a backfill of what
    // is missing, not a re-roll of what is there.
    expect(body.corruptionThemeSet).toBe(false)
  })

  it('reports a universe with no ranks distinctly from writing nothing', async () => {
    // null from the generator is a real answer: this world has no ladder.
    // It must not read as "the backfill silently did nothing", which is the
    // failure mode that hid the missing write at campaign creation.
    db.campaign.findUnique.mockResolvedValue({
      id: 'camp1', title: 'T', description: 'd', universe: 'Original', statLabels: null,
      corruptionTheme: null, advancementTrack: null,
    })
    ;(generateWorldExtras as any).mockResolvedValue({
      archetypes: [], corruptionTheme: null, advancementTrack: null,
    })
    const body = await (await POST(req(), { params: { id: 'camp1' } })).json()
    expect(body.advancementTrackSet).toBe(false)
    expect(body.advancementTierCount).toBe(null)
  })

  it('degrades to a clean 502 when generation fails', async () => {
    ;(generateWorldExtras as any).mockResolvedValue(null)
    const response = await POST(req(), { params: { id: 'camp1' } })
    expect(response.status).toBe(502)
  })

  it('creates archetypes and sets the corruption theme on success', async () => {
    ;(generateWorldExtras as any).mockResolvedValue({
      archetypes: [{ name: 'The Outsider', description: 'd', originFamiliarity: 'stranger', backstoryPrompts: [], glimpseCapabilityKeys: [] }],
      corruptionTheme: { name: 'The Rot' },
    })
    db.campaignArchetype.createMany.mockResolvedValue({ count: 1 })
    const response = await POST(req(), { params: { id: 'camp1' } })
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body).toEqual({
      archetypesCreated: 1,
      corruptionThemeSet: true,
      corruptionThemeName: 'The Rot',
      advancementTrackSet: false,
      advancementTierCount: null,
    })
    expect(db.campaign.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'camp1' },
      data: { corruptionTheme: { name: 'The Rot' } },
    }))
  })

  it('does not overwrite an existing corruption theme', async () => {
    db.campaign.findUnique.mockResolvedValue({
      id: 'camp1', title: 'T', description: 'd', universe: 'Original', statLabels: null,
      corruptionTheme: { name: 'Existing' },
    })
    ;(generateWorldExtras as any).mockResolvedValue({
      archetypes: [],
      corruptionTheme: { name: 'New Theme' },
    })
    const response = await POST(req(), { params: { id: 'camp1' } })
    const body = await response.json()
    expect(body.corruptionThemeSet).toBe(false)
    expect(db.campaign.update).not.toHaveBeenCalled()
  })

  it('returns 500 on an unexpected error', async () => {
    db.campaign.findUnique.mockRejectedValue(new Error('db down'))
    const response = await POST(req(), { params: { id: 'camp1' } })
    expect(response.status).toBe(500)
  })
})
