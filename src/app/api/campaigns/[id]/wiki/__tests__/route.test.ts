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

// Live simulation stats on /world entity cards. The fog-of-war property
// is the one that actually matters here: the stat row is a second path by
// which a hidden entity's real numbers could reach a player, independent
// of whether its entry is listed.
describe('GET entity stats', () => {
  it('attaches faction stats matched by name, case-insensitively', async () => {
    ;(getCampaignMembership as any).mockResolvedValue({ role: 'ADMIN' })
    db.wikiEntry.findMany.mockResolvedValue([
      { id: 'w1', entryType: 'FACTION', name: 'The Ashen Court', summary: 's', importance: 'normal' },
    ])
    db.faction.findMany.mockResolvedValue([
      { name: 'the ashen court', threatLevel: 4, stability: 20, isActive: true },
    ])

    const response = await GET(getRequest('?type=FACTION'), { params: { id: 'camp1' } })
    const { entries } = await response.json()

    // An admin sees the simulation as it is — the admin panel already
    // shows these numerically and debugging the tick needs them.
    expect(entries[0].stats).toEqual({
      kind: 'FACTION',
      threatLevel: 4,
      stability: 20,
      isActive: true,
    })
  })

  // #389: fog of war has two independent properties — WHICH entities you
  // may see, and HOW EXACTLY. This route respected the first (visibleTo)
  // and shipped raw integers for the second, giving players a precision
  // that wikiSync.ts, entitySummaries.ts and worldSummaryMappers.ts all
  // deliberately withhold — the last of those from the GM MODEL itself.
  it('bands faction stats for a PLAYER instead of shipping the exact figures', async () => {
    db.wikiEntry.findMany.mockResolvedValue([
      { id: 'w1', entryType: 'FACTION', name: 'The Ashen Court', summary: 's', importance: 'normal' },
    ])
    db.faction.findMany.mockResolvedValue([
      { name: 'the ashen court', threatLevel: 4, stability: 63, isActive: true },
    ])

    const response = await GET(getRequest('?type=FACTION'), { params: { id: 'camp1' } })
    const { entries } = await response.json()

    // 63 falls in the "Steady" band (50-74) and is reported as its
    // midpoint — the meter still renders, the exact figure never leaves
    // the server.
    expect(entries[0].stats.stability).not.toBe(63)
    expect(entries[0].stats.stability).toBe(62)
  })

  it('never sends influence or military to anyone', async () => {
    // Not rendered by EntityStatRow at all — pure over-fetch on top of
    // being a precision leak.
    db.wikiEntry.findMany.mockResolvedValue([
      { id: 'w1', entryType: 'FACTION', name: 'The Ashen Court', summary: 's', importance: 'normal' },
    ])
    db.faction.findMany.mockResolvedValue([
      { name: 'the ashen court', threatLevel: 4, stability: 63, isActive: true },
    ])

    const response = await GET(getRequest('?type=FACTION'), { params: { id: 'camp1' } })
    const { entries } = await response.json()

    expect(entries[0].stats.influence).toBeUndefined()
    expect(entries[0].stats.military).toBeUndefined()
    // And not even selected from the database.
    const selected = db.faction.findMany.mock.calls[0][0].select
    expect(selected.influence).toBeUndefined()
    expect(selected.military).toBeUndefined()
  })

  it('bands a location condition for a PLAYER', async () => {
    db.wikiEntry.findMany.mockResolvedValue([
      { id: 'w1', entryType: 'LOCATION', name: 'Kel Marsh', summary: 's', importance: 'normal' },
    ])
    db.location.findMany.mockResolvedValue([
      { name: 'Kel Marsh', conditionScore: 63, isContested: false, weather: 'CLEAR', weatherSeverity: 1 },
    ])

    const response = await GET(getRequest('?type=LOCATION'), { params: { id: 'camp1' } })
    const { entries } = await response.json()

    expect(entries[0].stats.conditionScore).toBe(62)
  })

  it('derives location condition tags with the same helper the tick uses', async () => {
    db.wikiEntry.findMany.mockResolvedValue([
      { id: 'w1', entryType: 'LOCATION', name: 'Kel Marsh', summary: 's', importance: 'normal' },
    ])
    db.location.findMany.mockResolvedValue([
      { name: 'Kel Marsh', conditionScore: 10, isContested: true, weather: 'STORM', weatherSeverity: 4 },
    ])

    const response = await GET(getRequest('?type=LOCATION'), { params: { id: 'camp1' } })
    const { entries } = await response.json()

    // conditionScore 10 -> RUINED, plus CONTESTED because isContested.
    expect(entries[0].stats.conditionTags).toEqual(['RUINED', 'CONTESTED'])
    expect(entries[0].stats.weather).toBe('STORM')
  })

  it('attaches clock progress', async () => {
    db.wikiEntry.findMany.mockResolvedValue([
      { id: 'w1', entryType: 'CLOCK', name: 'The Siege', summary: 's', importance: 'normal' },
    ])
    db.clock.findMany.mockResolvedValue([
      { name: 'The Siege', currentTicks: 3, maxTicks: 6, category: 'WAR' },
    ])

    const response = await GET(getRequest('?type=CLOCK'), { params: { id: 'camp1' } })
    const { entries } = await response.json()

    expect(entries[0].stats).toEqual({ kind: 'CLOCK', currentTicks: 3, maxTicks: 6, category: 'WAR' })
  })

  // An admin sees a hidden entity listed, so it reaches the enrichment
  // step. A player must not get its numbers even if the entry somehow got
  // that far — the visibility predicate is re-applied, not assumed.
  it('omits stats for an entity the viewer cannot see', async () => {
    db.wikiEntry.findMany.mockResolvedValue([
      { id: 'w1', entryType: 'FACTION', name: 'Hidden Cabal', summary: 's', importance: 'normal' },
    ])
    // Name-match query returns nothing: the visibility filter excluded it.
    db.faction.findMany.mockResolvedValue([])

    const response = await GET(getRequest('?type=FACTION'), { params: { id: 'camp1' } })
    const { entries } = await response.json()

    expect(entries.every((e: any) => e.stats === undefined)).toBe(true)
  })

  // Asserted as an admin on purpose: a PLAYER request always queries all
  // four tables to build filterDiscoveredEntries' name index, which would
  // mask whether the enrichment added a query of its own. An admin skips
  // that filter, so these counts are attributable to the enrichment and
  // the stub lookup alone — and with the type narrowed to LORE, both
  // should sit this out entirely.
  it('never queries stat tables for a Codex-only request', async () => {
    ;(getCampaignMembership as any).mockResolvedValue({ role: 'ADMIN' })
    db.wikiEntry.findMany.mockResolvedValue([
      { id: 'w1', entryType: 'LORE', name: 'The Long Winter', summary: 's', importance: 'normal' },
    ])

    await GET(getRequest('?type=LORE'), { params: { id: 'camp1' } })

    expect(db.faction.findMany).not.toHaveBeenCalled()
    expect(db.location.findMany).not.toHaveBeenCalled()
    expect(db.clock.findMany).not.toHaveBeenCalled()
  })
})
