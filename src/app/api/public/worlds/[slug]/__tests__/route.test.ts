// src/app/api/public/worlds/[slug]/__tests__/route.test.ts
//
// #490 — one world's public page. Returns a SUMMARY of the snapshot, never
// the snapshot: what is in a world is worth knowing before you fork it, but
// handing over the definition here would make the fork counter meaningless
// and the directory trivially copyable.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: { publishedWorld: { findUnique: vi.fn(), update: vi.fn() } },
}))

import { prisma } from '@/lib/prisma'
import { GET } from '../route'

const db = prisma as any
const params = { params: { slug: 'the-long-winter' } }

function req() {
  return new NextRequest('http://localhost/api/public/worlds/the-long-winter')
}

const snapshot = {
  version: 1,
  worldSeed: 'The pass has been closed since autumn.',
  factions: Array.from({ length: 9 }, (_, i) => ({ name: `Faction ${i}` })),
  capabilities: [
    { domain: 'Ember Work', name: 'a', tier: 1 },
    { domain: 'Ember Work', name: 'b', tier: 2 },
    { domain: 'Oathbinding', name: 'c', tier: 1 },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  db.publishedWorld.findUnique.mockResolvedValue({
    slug: 'the-long-winter', title: 'The Long Winter', description: 'd',
    universe: 'Original', snapshot, forkCount: 3, isListed: true,
    createdAt: new Date(), publisher: { name: 'Ada' },
  })
  db.publishedWorld.update.mockResolvedValue({})
})

describe('what it reports', () => {
  it('summarises the world without shipping its definition', async () => {
    const body = await (await GET(req(), params)).json()

    expect(body.world).toMatchObject({
      slug: 'the-long-winter',
      factionCount: 9,
      capabilityCount: 3,
      premise: 'The pass has been closed since autumn.',
    })
    // Names enough to judge it, not enough to rebuild it.
    expect(body.world.factionNames).toHaveLength(6)
    expect(body.world.capabilityDomains).toEqual(['Ember Work', 'Oathbinding'])
    expect(JSON.stringify(body)).not.toContain('"tier"')
  })

  it('serves an unlisted world by its direct link', async () => {
    // The difference between unlisting and deleting, and what keeps
    // already-shared links working.
    db.publishedWorld.findUnique.mockResolvedValue({
      slug: 's', title: 't', description: 'd', universe: 'u', snapshot,
      forkCount: 0, isListed: false, createdAt: new Date(), publisher: { name: 'Ada' },
    })
    const response = await GET(req(), params)
    expect(response.status).toBe(200)
    expect((await response.json()).world.isListed).toBe(false)
  })

  it('404s an unknown slug', async () => {
    db.publishedWorld.findUnique.mockResolvedValue(null)
    expect((await GET(req(), params)).status).toBe(404)
  })

  it('counts the view', async () => {
    await GET(req(), params)
    expect(db.publishedWorld.update).toHaveBeenCalledWith({
      where: { slug: 'the-long-winter' },
      data: { viewCount: { increment: 1 } },
    })
  })

  it('still serves the page when the counter fails', async () => {
    db.publishedWorld.update.mockRejectedValue(new Error('counter down'))
    expect((await GET(req(), params)).status).toBe(200)
  })

  it('survives a snapshot with nothing in it', async () => {
    db.publishedWorld.findUnique.mockResolvedValue({
      slug: 's', title: 't', description: '', universe: 'u', snapshot: {},
      forkCount: 0, isListed: true, createdAt: new Date(), publisher: { name: null },
    })
    const body = await (await GET(req(), params)).json()
    expect(body.world).toMatchObject({ factionCount: 0, capabilityCount: 0, premise: '', author: 'Anonymous' })
  })
})
