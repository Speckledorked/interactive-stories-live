// src/app/api/worlds/[slug]/fork/__tests__/route.test.ts
//
// #490 — one click from reading about a world to playing in it.
//
// The assertions that matter: the fork makes NO model calls (that is what
// makes it one click, and what makes it free), it belongs to the forker and
// not the author, and an unreadable snapshot is refused rather than
// half-seeded.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ getUser: vi.fn() }))
vi.mock('@/lib/analytics/events', () => ({ recordEvent: vi.fn() }))
vi.mock('@/lib/game/campaignCreation', () => ({ createCampaign: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { publishedWorld: { findUnique: vi.fn(), update: vi.fn() } },
}))

import { getUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { createCampaign } from '@/lib/game/campaignCreation'
import { recordEvent } from '@/lib/analytics/events'
import { POST } from '../route'

const db = prisma as any
const params = { params: { slug: 'the-long-winter' } }

function req(body: unknown = {}) {
  return new NextRequest('http://localhost/api/worlds/the-long-winter/fork', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const snapshot = {
  version: 1,
  worldSeed: 'The pass has been closed since autumn.',
  factions: [{ name: 'Ashcrown', description: 'd', goals: 'g', resources: 50, influence: 40, threatLevel: 2 }],
  capabilities: [],
  statLabels: null,
  fronts: [],
  archetypes: [],
  corruptionTheme: null,
  advancementTrack: null,
  calendar: null,
  worldRules: [],
  moveFlavor: [],
  npcs: [],
  locations: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getUser as any).mockResolvedValue({ userId: 'forker1' })
  db.publishedWorld.findUnique.mockResolvedValue({
    id: 'pw1', title: 'The Long Winter', description: 'Cold war, warmer ground',
    universe: 'Original', snapshot,
  })
  db.publishedWorld.update.mockResolvedValue({})
  ;(createCampaign as any).mockResolvedValue({ id: 'camp-new' })
})

describe('access', () => {
  it('requires a signed-in user', async () => {
    ;(getUser as any).mockResolvedValue(null)
    expect((await POST(req(), params)).status).toBe(401)
  })

  it('404s an unknown slug', async () => {
    db.publishedWorld.findUnique.mockResolvedValue(null)
    expect((await POST(req(), params)).status).toBe(404)
  })
})

describe('the fork itself', () => {
  it('creates the campaign for the FORKER, as its admin', async () => {
    const response = await POST(req(), params)

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ campaignId: 'camp-new' })
    expect(createCampaign).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'forker1', title: 'The Long Winter' })
    )
  })

  it('makes no model calls — the world is already generated', async () => {
    // The whole reason this is synchronous while ordinary creation (#493) is
    // a background job. Pass preGenerated and both generation stages are
    // skipped; omit it and a fork would cost five provider calls and a
    // minute, which is not one click.
    await POST(req(), params)

    const args = (createCampaign as any).mock.calls[0][0]
    expect(args.preGenerated).toBeTruthy()
    expect(args.preGenerated.factions).toHaveLength(1)
    expect(args.preGenerated.worldSeed).toBe('The pass has been closed since autumn.')
  })

  it('carries the published premise as the seed', async () => {
    // Otherwise the forked world opens on nothing, having thrown away the
    // one piece of the setting that says what is happening.
    await POST(req(), params)
    expect((createCampaign as any).mock.calls[0][0].initialWorldSeed).toBe(
      'The pass has been closed since autumn.'
    )
  })

  it('does not copy the author\'s own GM direction', async () => {
    // aiSystemPrompt is how one person runs their table, not part of the
    // setting the way factions and a calendar are.
    await POST(req(), params)
    expect((createCampaign as any).mock.calls[0][0].resolvedSystemPrompt).toBe('')
  })

  it('accepts a title of the forker\'s own', async () => {
    await POST(req({ title: 'Winter, Again' }), params)
    expect((createCampaign as any).mock.calls[0][0].title).toBe('Winter, Again')
  })

  it('counts the fork only once the campaign exists', async () => {
    // So the number means "worlds actually started from this" rather than
    // "times someone pressed the button".
    await POST(req(), params)
    expect(db.publishedWorld.update).toHaveBeenCalledWith({
      where: { id: 'pw1' },
      data: { forkCount: { increment: 1 } },
    })
  })

  it('does not count a fork that failed', async () => {
    ;(createCampaign as any).mockRejectedValue(new Error('db down'))

    const response = await POST(req(), params)

    expect(response.status).toBe(500)
    expect(db.publishedWorld.update).not.toHaveBeenCalled()
  })

  it('still succeeds when only the counter fails', async () => {
    db.publishedWorld.update.mockRejectedValue(new Error('counter down'))
    const response = await POST(req(), params)
    expect(response.status).toBe(201)
  })

  it('records the funnel event against the new campaign', async () => {
    await POST(req(), params)
    expect(recordEvent).toHaveBeenCalledWith('CAMPAIGN_CREATED', {
      userId: 'forker1',
      campaignId: 'camp-new',
    })
  })
})

describe('a snapshot this build cannot read', () => {
  it('refuses rather than seeding a world from misread fields', async () => {
    db.publishedWorld.findUnique.mockResolvedValue({
      id: 'pw1', title: 'T', description: '', universe: 'Original',
      snapshot: { version: 99 },
    })

    const response = await POST(req(), params)

    expect(response.status).toBe(409)
    expect(createCampaign).not.toHaveBeenCalled()
    expect(db.publishedWorld.update).not.toHaveBeenCalled()
  })
})
