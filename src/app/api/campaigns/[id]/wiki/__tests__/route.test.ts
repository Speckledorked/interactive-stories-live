// src/app/api/campaigns/[id]/wiki/__tests__/route.test.ts
// #135 (cont.) — the wiki index had no test coverage: GET's defense-in-
// depth re-filtering of entries against current discovery state (an
// entity discovered, written up, then re-hidden must disappear again even
// though its WikiEntry row still exists), and that admins skip the
// filter entirely, were both unverified. POST's admin-only gate was too.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ getUser: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({ getCampaignMembership: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    wikiEntry: { findMany: vi.fn(), create: vi.fn() },
    nPC: { findMany: vi.fn() },
    faction: { findMany: vi.fn() },
    location: { findMany: vi.fn() },
    clock: { findMany: vi.fn() },
    campaignMembership: { findFirst: vi.fn() },
    character: { findFirst: vi.fn() },
  },
}))

import { getUser } from '@/lib/auth'
import { getCampaignMembership } from '@/lib/db/campaignAccess'
import { prisma } from '@/lib/prisma'
import { GET, POST } from '../route'

const db = prisma as any

function getRequest(query = '') {
  return new NextRequest(`http://localhost/api/campaigns/camp1/wiki${query}`)
}

function postRequest(body: unknown) {
  return new NextRequest('http://localhost/api/campaigns/camp1/wiki', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getUser as any).mockResolvedValue({ userId: 'player1' })
  ;(getCampaignMembership as any).mockResolvedValue({ role: 'PLAYER' })
  db.nPC.findMany.mockResolvedValue([])
  db.faction.findMany.mockResolvedValue([])
  db.location.findMany.mockResolvedValue([])
  db.clock.findMany.mockResolvedValue([])
  db.character.findFirst.mockResolvedValue(null)
})

describe('GET', () => {
  it('rejects an unauthenticated request', async () => {
    ;(getUser as any).mockResolvedValue(null)
    const response = await GET(getRequest(), { params: { id: 'camp1' } })
    expect(response.status).toBe(401)
  })

  it('rejects a non-member', async () => {
    ;(getCampaignMembership as any).mockResolvedValue(null)
    const response = await GET(getRequest(), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
  })

  it('hides a wiki entry for an NPC that has since been re-hidden', async () => {
    db.wikiEntry.findMany.mockResolvedValue([
      { entryType: 'NPC', name: 'Elder Rowan' },
    ])
    // No discovered NPCs matching that name — it was re-hidden.
    db.nPC.findMany.mockResolvedValue([])

    const response = await GET(getRequest(), { params: { id: 'camp1' } })
    const body = await response.json()

    expect(body.entries.find((e: any) => e.name === 'Elder Rowan')).toBeUndefined()
  })

  it('keeps a wiki entry for a still-discovered NPC', async () => {
    db.wikiEntry.findMany.mockResolvedValue([{ entryType: 'NPC', name: 'Elder Rowan' }])
    db.nPC.findMany.mockResolvedValue([{ name: 'Elder Rowan' }])

    const response = await GET(getRequest(), { params: { id: 'camp1' } })
    const body = await response.json()

    expect(body.entries.find((e: any) => e.name === 'Elder Rowan')).toBeDefined()
  })

  it('skips the discovery re-filter entirely for an admin', async () => {
    ;(getCampaignMembership as any).mockResolvedValue({ role: 'ADMIN' })
    db.wikiEntry.findMany.mockResolvedValue([{ entryType: 'NPC', name: 'Secretly Hidden' }])

    const response = await GET(getRequest(), { params: { id: 'camp1' } })
    const body = await response.json()

    expect(body.entries.find((e: any) => e.name === 'Secretly Hidden')).toBeDefined()
    // The discovery-filter queries never run for an admin.
    expect(db.nPC.findMany).not.toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ isDiscovered: true }),
    }))
  })

  it('synthesizes a stub entry for a discovered faction no scene has written up yet', async () => {
    db.wikiEntry.findMany.mockResolvedValue([])
    db.faction.findMany.mockResolvedValue([
      { id: 'f1', name: 'Thieves Guild', description: null, createdAt: new Date(), updatedAt: new Date() },
    ])

    const response = await GET(getRequest(), { params: { id: 'camp1' } })
    const body = await response.json()

    const stub = body.entries.find((e: any) => e.name === 'Thieves Guild')
    expect(stub).toBeDefined()
    expect(stub.entryType).toBe('FACTION')
    expect(stub.createdBy).toBe('world')
  })

  it('does not stub an entity that already has a real wiki entry', async () => {
    db.wikiEntry.findMany.mockResolvedValue([{ entryType: 'FACTION', name: 'Thieves Guild', importance: 'normal' }])
    db.faction.findMany.mockResolvedValue([
      { id: 'f1', name: 'Thieves Guild', description: null, createdAt: new Date(), updatedAt: new Date() },
    ])

    const response = await GET(getRequest(), { params: { id: 'camp1' } })
    const body = await response.json()

    const matches = body.entries.filter((e: any) => e.name === 'Thieves Guild')
    expect(matches.length).toBe(1)
  })

  it('filters by entryType when a type is requested', async () => {
    db.wikiEntry.findMany.mockResolvedValue([])
    await GET(getRequest('?type=NPC'), { params: { id: 'camp1' } })
    expect(db.wikiEntry.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { campaignId: 'camp1', entryType: 'NPC' },
    }))
  })

  it('attaches diegetic myStanding labels from the requesting user\'s own character', async () => {
    db.wikiEntry.findMany.mockResolvedValue([{ entryType: 'NPC', name: 'Elder Rowan' }])
    db.nPC.findMany.mockResolvedValue([{ id: 'npc1', name: 'Elder Rowan' }])
    db.character.findFirst.mockResolvedValue({
      relationships: { npc1: { trust: 60, tension: 0, respect: 0, fear: 0 } },
    })

    const response = await GET(getRequest(), { params: { id: 'camp1' } })
    const body = await response.json()

    const entry = body.entries.find((e: any) => e.name === 'Elder Rowan')
    expect(entry.myStanding).toEqual(['Trusts you'])
    // Never the raw numbers.
    expect(JSON.stringify(entry)).not.toContain('60')
  })

  it('gives an empty myStanding when the user has no character in this campaign yet', async () => {
    db.wikiEntry.findMany.mockResolvedValue([{ entryType: 'NPC', name: 'Elder Rowan' }])
    db.nPC.findMany.mockResolvedValue([{ id: 'npc1', name: 'Elder Rowan' }])
    db.character.findFirst.mockResolvedValue(null)

    const response = await GET(getRequest(), { params: { id: 'camp1' } })
    const body = await response.json()

    expect(body.entries.find((e: any) => e.name === 'Elder Rowan').myStanding).toEqual([])
  })

  it('skips the character lookup entirely when no NPC entries are in play', async () => {
    db.wikiEntry.findMany.mockResolvedValue([{ entryType: 'FACTION', name: 'Thieves Guild' }])
    db.faction.findMany.mockResolvedValue([{ id: 'f1', name: 'Thieves Guild' }])

    await GET(getRequest('?type=FACTION'), { params: { id: 'camp1' } })

    expect(db.character.findFirst).not.toHaveBeenCalled()
  })
})

describe('POST', () => {
  it('rejects an unauthenticated request', async () => {
    ;(getUser as any).mockResolvedValue(null)
    const response = await POST(postRequest({ entryType: 'NPC', name: 'Test' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(401)
  })

  it('rejects a non-admin', async () => {
    db.campaignMembership.findFirst.mockResolvedValue(null)
    const response = await POST(postRequest({ entryType: 'NPC', name: 'Test' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
    expect(db.wikiEntry.create).not.toHaveBeenCalled()
  })

  it('creates the entry for an admin', async () => {
    db.campaignMembership.findFirst.mockResolvedValue({ id: 'mem1', role: 'ADMIN' })
    db.wikiEntry.create.mockResolvedValue({ id: 'entry1', name: 'Test' })

    const response = await POST(postRequest({ entryType: 'NPC', name: 'Test', summary: 's', description: 'd' }), { params: { id: 'camp1' } })

    expect(response.status).toBe(201)
    expect(db.wikiEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ campaignId: 'camp1', entryType: 'NPC', name: 'Test', createdBy: 'ai' }),
    })
  })
})
