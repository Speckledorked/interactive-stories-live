// src/app/api/campaigns/[id]/characters/[characterId]/knowledge/__tests__/route.test.ts
// #520 — the three properties this route exists to hold: knowledge is
// private to its owner, the fog applies to the events behind it, and
// WorldEvent.reason never leaves the server.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ getUser: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({ getCampaignMembership: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    character: { findUnique: vi.fn() },
    eventWitness: { findMany: vi.fn() },
    faction: { findMany: vi.fn() },
    nPC: { findMany: vi.fn() },
    location: { findMany: vi.fn() },
    clock: { findMany: vi.fn() },
  },
}))

import { getUser } from '@/lib/auth'
import { getCampaignMembership } from '@/lib/db/campaignAccess'
import { prisma } from '@/lib/prisma'
import { GET } from '../route'

const db = prisma as any

function request() {
  return new NextRequest('http://localhost/api/campaigns/camp1/characters/char1/knowledge')
}

const params = { params: { id: 'camp1', characterId: 'char1' } }

/** A witness row whose target is the discovered faction f1. */
function witnessRow(overrides: Record<string, unknown> = {}) {
  return {
    grade: 'WITNESSED',
    turnNumber: 7,
    distorted: false,
    worldEvent: {
      type: 'faction.resources',
      targetType: 'FACTION',
      targetId: 'f1',
      targetName: 'The Iron Company',
      previousValue: '40',
      newValue: '44',
    },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getUser as any).mockResolvedValue({ userId: 'player1', email: 'player1@example.com' })
  ;(getCampaignMembership as any).mockResolvedValue({ role: 'PLAYER' })
  db.character.findUnique.mockResolvedValue({
    id: 'char1',
    userId: 'player1',
    campaignId: 'camp1',
  })
  db.eventWitness.findMany.mockResolvedValue([witnessRow()])
  // Fog: f1 is discovered, nothing else is.
  db.faction.findMany.mockResolvedValue([{ id: 'f1' }])
  db.nPC.findMany.mockResolvedValue([])
  db.location.findMany.mockResolvedValue([])
  db.clock.findMany.mockResolvedValue([])
})

describe('GET', () => {
  it('rejects a non-member', async () => {
    ;(getCampaignMembership as any).mockResolvedValue(null)
    expect((await GET(request(), params)).status).toBe(403)
  })

  it('404s when the character does not exist', async () => {
    db.character.findUnique.mockResolvedValue(null)
    expect((await GET(request(), params)).status).toBe(404)
  })

  it('404s for a character belonging to another campaign', async () => {
    // Not 403: cross-campaign ids should not confirm the row exists.
    db.character.findUnique.mockResolvedValue({
      id: 'char1',
      userId: 'player1',
      campaignId: 'someone-elses-campaign',
    })
    expect((await GET(request(), params)).status).toBe(404)
  })

  it("refuses to show one player another player's knowledge", async () => {
    db.character.findUnique.mockResolvedValue({
      id: 'char1',
      userId: 'a-different-player',
      campaignId: 'camp1',
    })
    const response = await GET(request(), params)
    expect(response.status).toBe(403)
    // And nothing was read on the way to refusing.
    expect(db.eventWitness.findMany).not.toHaveBeenCalled()
  })

  it('lets the campaign admin read it', async () => {
    ;(getCampaignMembership as any).mockResolvedValue({ role: 'ADMIN' })
    db.character.findUnique.mockResolvedValue({
      id: 'char1',
      userId: 'a-different-player',
      campaignId: 'camp1',
    })
    expect((await GET(request(), params)).status).toBe(200)
  })

  it('returns a phrased sentence rather than the raw change', async () => {
    const response = await GET(request(), params)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.firsthand).toHaveLength(1)
    expect(body.firsthand[0].text).toBe('The Iron Company has grown wealthier.')
    // The anti-spreadsheet property, at the route boundary.
    expect(body.firsthand[0].text).not.toMatch(/\d/)
    expect(body.firsthand[0].doubtful).toBe(false)
  })

  it('never selects WorldEvent.reason', async () => {
    // The field is admin-only for a reason; the guarantee is that it is not
    // fetched at all, so it cannot reach a serializer by accident.
    await GET(request(), params)
    const select = db.eventWitness.findMany.mock.calls[0][0].select.worldEvent.select
    expect(select).not.toHaveProperty('reason')
  })

  it('drops events about something the party has not discovered', async () => {
    db.faction.findMany.mockResolvedValue([]) // f1 no longer discovered
    const body = await (await GET(request(), params)).json()
    expect(body.firsthand).toEqual([])
    expect(body.secondhand).toEqual([])
  })

  it('does not gate an event type that models no discovery', async () => {
    // WAR, QUEST, CHARACTER and DEBT are absent from
    // DISCOVERY_SOURCE_BY_ENTITY_TYPE because a war is not something the
    // party "learns exists". This route first shipped denying every
    // unlisted type, which silently dropped events the world digest and
    // the absence journal both show.
    db.faction.findMany.mockResolvedValue([])
    db.eventWitness.findMany.mockResolvedValue([
      witnessRow({
        worldEvent: {
          type: 'faction.warDeclared',
          targetType: 'WAR',
          targetId: 'war1',
          targetName: 'The Salt Road War',
          previousValue: null,
          newValue: null,
        },
      }),
    ])
    const body = await (await GET(request(), params)).json()
    expect(body.firsthand).toHaveLength(1)
  })

  it('splits what was witnessed from what was merely heard', async () => {
    db.eventWitness.findMany.mockResolvedValue([
      witnessRow({ grade: 'WITNESSED', turnNumber: 9 }),
      witnessRow({ grade: 'TOLD', turnNumber: 4, distorted: true }),
    ])
    const body = await (await GET(request(), params)).json()

    expect(body.firsthand).toHaveLength(1)
    expect(body.secondhand).toHaveLength(1)
    expect(body.secondhand[0].doubtful).toBe(true)
  })

  it('will not mark a firsthand account doubtful', async () => {
    // WITNESSED is ground truth by construction; the schema's invariant is
    // caller-enforced, so the projection re-asserts it.
    db.eventWitness.findMany.mockResolvedValue([
      witnessRow({ grade: 'WITNESSED', distorted: true }),
    ])
    const body = await (await GET(request(), params)).json()
    expect(body.firsthand[0].doubtful).toBe(false)
  })
})
