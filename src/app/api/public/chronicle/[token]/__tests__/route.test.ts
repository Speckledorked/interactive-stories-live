// src/app/api/public/chronicle/[token]/__tests__/route.test.ts
// #135 (cont.) — the unauthenticated public chronicle read had no test
// coverage: that a disabled/nonexistent share (including a token that
// once worked but was disabled since — chronicle-share/route.ts clears
// the token entirely on disable, so this can never actually happen, but
// the route's own guard is what enforces it) 404s the same way, that
// only RESOLVED scenes are ever returned, and that GM-only fields never
// appear in the response, were all unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: { findUnique: vi.fn() },
    scene: { findMany: vi.fn() },
    // #490: the chronicle now also looks up whether this campaign's world
    // is published, so it can offer its reader a way in.
    publishedWorld: { findFirst: vi.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import { GET } from '../route'

const db = prisma as any

function req(token: string) {
  return new NextRequest(`http://localhost/api/public/chronicle/${token}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  db.scene.findMany.mockResolvedValue([])
  db.publishedWorld.findFirst.mockResolvedValue(null)
})

describe('GET', () => {
  it('404s for an unknown token', async () => {
    db.campaign.findUnique.mockResolvedValue(null)
    const response = await GET(req('bad-token'), { params: { token: 'bad-token' } })
    expect(response.status).toBe(404)
  })

  it('404s for a token whose sharing has been disabled', async () => {
    db.campaign.findUnique.mockResolvedValue({ id: 'camp1', title: 'T', chronicleShareEnabled: false })
    const response = await GET(req('old-token'), { params: { token: 'old-token' } })
    expect(response.status).toBe(404)
    expect(db.scene.findMany).not.toHaveBeenCalled()
  })

  it('only queries RESOLVED scenes', async () => {
    db.campaign.findUnique.mockResolvedValue({ id: 'camp1', title: 'T', description: 'd', universe: 'Original', chronicleShareEnabled: true })
    await GET(req('live-token'), { params: { token: 'live-token' } })
    expect(db.scene.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { campaignId: 'camp1', status: 'RESOLVED' },
    }))
  })

  it('returns only public narrative fields, never GM data', async () => {
    db.campaign.findUnique.mockResolvedValue({ id: 'camp1', title: 'T', description: 'd', universe: 'Original', chronicleShareEnabled: true })
    db.scene.findMany.mockResolvedValue([
      { sceneNumber: 1, sceneIntroText: 'intro', sceneResolutionText: 'resolution' },
    ])
    const response = await GET(req('live-token'), { params: { token: 'live-token' } })
    const body = await response.json()
    expect(response.status).toBe(200)
    // Deliberately toEqual rather than toMatchObject: this is the test that
    // says what an unauthenticated reader is allowed to see, so every field
    // added to this response has to be declared HERE before it ships. A
    // loosened assertion is how a GM-only field arrives unnoticed.
    expect(body).toEqual({
      campaign: { title: 'T', description: 'd', universe: 'Original' },
      // #490: the slug of this campaign's published world, or null. A slug
      // is already public by construction — it is in the directory.
      worldSlug: null,
      // No title field: Scene.title was a column nothing ever wrote
      // (dropped 20260820140000), so the chronicle stopped shipping it.
      scenes: [{ sceneNumber: 1, introText: 'intro', resolutionText: 'resolution' }],
    })
    expect(JSON.stringify(body)).not.toContain('chronicleShareToken')
  })

  it('returns 500 on an unexpected error', async () => {
    db.campaign.findUnique.mockRejectedValue(new Error('db down'))
    const response = await GET(req('live-token'), { params: { token: 'live-token' } })
    expect(response.status).toBe(500)
  })

  // #490: the link out. These share links were well-built dead ends — a
  // reader could finish a whole campaign and have nowhere to go with it.
  it('offers the world when this campaign has published one', async () => {
    db.campaign.findUnique.mockResolvedValue({ id: 'camp1', title: 'T', description: null, universe: null, chronicleShareEnabled: true })
    db.publishedWorld.findFirst.mockResolvedValue({ slug: 'the-long-winter' })

    const body = await (await GET(req('live-token'), { params: { token: 'live-token' } })).json()

    expect(body.worldSlug).toBe('the-long-winter')
  })

  it('offers nothing when the campaign has published no world', async () => {
    db.campaign.findUnique.mockResolvedValue({ id: 'camp1', title: 'T', description: null, universe: null, chronicleShareEnabled: true })
    db.publishedWorld.findFirst.mockResolvedValue(null)

    const body = await (await GET(req('live-token'), { params: { token: 'live-token' } })).json()

    expect(body.worldSlug).toBeNull()
  })

  it('offers nothing for a world the author has unlisted', async () => {
    // Unlisting is the author saying they would rather not be a starting
    // point. A CTA that ignored that would make unlisting meaningless on
    // the surface that drives the most traffic to it.
    db.campaign.findUnique.mockResolvedValue({ id: 'camp1', title: 'T', description: null, universe: null, chronicleShareEnabled: true })

    await GET(req('live-token'), { params: { token: 'live-token' } })

    expect(db.publishedWorld.findFirst.mock.calls[0][0].where.isListed).toBe(true)
  })
})
