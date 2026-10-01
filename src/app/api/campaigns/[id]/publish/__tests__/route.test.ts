// src/app/api/campaigns/[id]/publish/__tests__/route.test.ts
//
// #490 — publishing a world, and taking it back down.
//
// Admin-only because publishing exposes the whole definition, which is the
// work of whoever ran the campaign rather than of anyone who played in it.
// Republishing must refresh in place, because a slug that has been shared
// cannot change. And unlisting must not delete, because forks and links
// already exist.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ getUser: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({ requireCampaignAdmin: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: { findUnique: vi.fn() },
    faction: { findMany: vi.fn() },
    campaignCapability: { findMany: vi.fn() },
    clock: { findMany: vi.fn() },
    campaignArchetype: { findMany: vi.fn() },
    move: { findMany: vi.fn() },
    nPC: { findMany: vi.fn() },
    location: { findMany: vi.fn() },
    publishedWorld: {
      findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(),
    },
  },
}))

import { getUser } from '@/lib/auth'
import { requireCampaignAdmin } from '@/lib/db/campaignAccess'
import { prisma } from '@/lib/prisma'
import { visibleTo } from '@/lib/api/visibility'
import { POST, DELETE, GET } from '../route'

const db = prisma as any
const params = { params: { id: 'camp1' } }

function req(method = 'POST') {
  return new NextRequest('http://localhost/api/campaigns/camp1/publish', { method })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getUser as any).mockResolvedValue({ userId: 'gm1' })
  ;(requireCampaignAdmin as any).mockResolvedValue({ membership: { role: 'ADMIN' } })
  db.campaign.findUnique.mockResolvedValue({
    title: 'The Long Winter',
    description: 'Cold war, warmer ground',
    universe: 'Original',
    initialWorldSeed: 'The pass has been closed since autumn.',
    statLabels: null, corruptionTheme: null, advancementTrack: null,
    calendarConfig: null, worldRules: null,
  })
  db.faction.findMany.mockResolvedValue([
    { name: 'Ashcrown', description: 'd', goals: 'g', resources: 50, influence: 40, threatLevel: 2 },
  ])
  db.campaignCapability.findMany.mockResolvedValue([])
  db.clock.findMany.mockResolvedValue([])
  db.campaignArchetype.findMany.mockResolvedValue([])
  db.move.findMany.mockResolvedValue([])
  db.nPC.findMany.mockResolvedValue([])
  db.location.findMany.mockResolvedValue([])
  db.publishedWorld.findUnique.mockResolvedValue(null)
  db.publishedWorld.findFirst.mockResolvedValue(null)
  db.publishedWorld.create.mockImplementation(async ({ data }: any) => ({
    slug: data.slug, forkCount: 0,
  }))
  db.publishedWorld.update.mockResolvedValue({ slug: 'the-long-winter', forkCount: 3 })
})

describe('access', () => {
  it('rejects an unauthenticated request', async () => {
    ;(getUser as any).mockResolvedValue(null)
    expect((await POST(req(), params)).status).toBe(401)
  })

  it('defers to the admin gate', async () => {
    ;(requireCampaignAdmin as any).mockResolvedValue({ response: new Response('no', { status: 403 }) })
    expect((await POST(req(), params)).status).toBe(403)
    expect(db.publishedWorld.create).not.toHaveBeenCalled()
  })
})

describe('publishing', () => {
  it('stores the world under a slug derived from its title', async () => {
    const body = await (await POST(req(), params)).json()

    expect(body.slug).toBe('the-long-winter')
    expect(db.publishedWorld.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sourceCampaignId: 'camp1',
          publishedBy: 'gm1',
          universe: 'Original',
        }),
      })
    )
  })

  it('stores a versioned snapshot, not raw rows', async () => {
    await POST(req(), params)
    const snapshot = db.publishedWorld.create.mock.calls[0][0].data.snapshot
    expect(snapshot.version).toBe(1)
    expect(snapshot.factions).toHaveLength(1)
  })

  it('falls back to a universe when the campaign has none', async () => {
    db.campaign.findUnique.mockResolvedValue({
      title: 'T', description: null, universe: null, initialWorldSeed: '',
      statLabels: null, corruptionTheme: null, advancementTrack: null,
      calendarConfig: null, worldRules: null,
    })
    db.campaignCapability.findMany.mockResolvedValue([
      { domain: 'd', name: 'n', description: 'd', tier: 1, isSecret: false },
    ])

    await POST(req(), params)

    expect(db.publishedWorld.create.mock.calls[0][0].data.universe).toBe('Original')
  })

  it('refuses a world nobody could start from', async () => {
    // No factions, no capability tree — an empty campaign. Refused here so
    // the person who can fix it hears about it, rather than the first
    // stranger who forks it.
    db.faction.findMany.mockResolvedValue([])
    db.campaignCapability.findMany.mockResolvedValue([])

    const response = await POST(req(), params)

    expect(response.status).toBe(400)
    expect(db.publishedWorld.create).not.toHaveBeenCalled()
  })

  it('refuses a title that cannot become a web address', async () => {
    db.campaign.findUnique.mockResolvedValue({
      title: '!!!', description: null, universe: 'Original', initialWorldSeed: '',
      statLabels: null, corruptionTheme: null, advancementTrack: null,
      calendarConfig: null, worldRules: null,
    })

    const response = await POST(req(), params)

    expect(response.status).toBe(400)
    expect(db.publishedWorld.create).not.toHaveBeenCalled()
  })

  it('suffixes the slug when the plain one is taken', async () => {
    db.publishedWorld.findUnique
      .mockResolvedValueOnce({ id: 'other' })
      .mockResolvedValue(null)

    const body = await (await POST(req(), params)).json()

    expect(body.slug).toMatch(/^the-long-winter-[a-z0-9]{4}$/)
  })

  it('caps the NPC and location snapshots rather than taking a census', async () => {
    // A long-running campaign accumulates hundreds through play; a starting
    // world wants the notable ones.
    await POST(req(), params)
    expect(db.nPC.findMany.mock.calls[0][0].take).toBeGreaterThan(0)
    expect(db.location.findMany.mock.calls[0][0].take).toBeGreaterThan(0)
  })

  it('leaves hidden clocks out of the published fronts', async () => {
    // A hidden clock is a GM secret: publishing one hands every forker a
    // spoiler the author never meant to share. Asserted through visibleTo
    // rather than against a literal `isHidden: false`, because clocks gate
    // on isHidden while everything else gates on isDiscovered — opposite
    // polarity, and hand-rolling it is how that gets inverted.
    await POST(req(), params)
    expect(db.clock.findMany.mock.calls[0][0].where).toEqual({
      campaignId: 'camp1',
      ...visibleTo('clock', 'PLAYER'),
    })
  })

  it('snapshots what a PLAYER could see, not what the publishing admin can', async () => {
    // The publisher is an admin and would see everything. The question a
    // snapshot asks is not "what can I see" but "what is this world allowed
    // to show someone who has not played it".
    await POST(req(), params)
    const where = db.clock.findMany.mock.calls[0][0].where
    expect(where).not.toEqual({ campaignId: 'camp1' })
  })
})

describe('republishing', () => {
  it('refreshes in place and keeps the slug', async () => {
    // The slug is already in links people have shared. A second row would
    // also split the fork count across two entries for one world.
    db.publishedWorld.findFirst.mockResolvedValue({ id: 'pw1', slug: 'the-long-winter' })

    const body = await (await POST(req(), params)).json()

    expect(body).toMatchObject({ slug: 'the-long-winter', republished: true, forkCount: 3 })
    expect(db.publishedWorld.create).not.toHaveBeenCalled()
  })

  it('relists a world that had been unlisted', async () => {
    db.publishedWorld.findFirst.mockResolvedValue({ id: 'pw1', slug: 'the-long-winter' })
    await POST(req(), params)
    expect(db.publishedWorld.update.mock.calls[0][0].data.isListed).toBe(true)
  })
})

describe('unlisting', () => {
  it('hides the world without deleting it', async () => {
    // Existing forks and shared links keep working; the author can relist.
    const response = await DELETE(req('DELETE'), params)

    expect(response.status).toBe(200)
    expect(db.publishedWorld.updateMany).toHaveBeenCalledWith({
      where: { sourceCampaignId: 'camp1' },
      data: { isListed: false },
    })
  })

  it('defers to the admin gate', async () => {
    ;(requireCampaignAdmin as any).mockResolvedValue({ response: new Response('no', { status: 403 }) })
    expect((await DELETE(req('DELETE'), params)).status).toBe(403)
    expect(db.publishedWorld.updateMany).not.toHaveBeenCalled()
  })
})

describe('status', () => {
  it('reports null for a campaign that has never been published', async () => {
    const body = await (await GET(req('GET'), params)).json()
    expect(body.published).toBeNull()
  })

  it('reports the slug and counters once it has', async () => {
    db.publishedWorld.findFirst.mockResolvedValue({
      slug: 'the-long-winter', isListed: true, forkCount: 3, viewCount: 40, updatedAt: new Date(),
    })
    const body = await (await GET(req('GET'), params)).json()
    expect(body.published).toMatchObject({ slug: 'the-long-winter', forkCount: 3 })
  })
})
