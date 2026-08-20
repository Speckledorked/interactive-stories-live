// src/app/api/campaigns/[id]/characters/[characterId]/__tests__/route.test.ts
// #93 — PATCH carries the anti-cheat PLAYER_EDITABLE_FIELDS allowlist (the
// only thing stopping a player from PATCHing their own harm/stats/inventory
// directly); DELETE carries the ownership-or-admin gate. Neither had any
// test coverage.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ getUser: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({ getCampaignMembership: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    character: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    campaign: { findUnique: vi.fn() },
  },
}))
vi.mock('@/lib/game/advancement', () => ({ validateStats: vi.fn() }))
vi.mock('@/lib/game/capabilities', () => ({ summarizeCapabilities: vi.fn().mockReturnValue([]) }))
vi.mock('@/lib/game/debts', () => ({ summarizeDebts: vi.fn().mockReturnValue([]) }))
vi.mock('@/lib/game/standing', () => ({ summarizeStandings: vi.fn().mockReturnValue([]) }))
vi.mock('@/lib/wiki/contactNpcStubs', () => ({ ensureContactNpcStubs: vi.fn() }))

import { getUser } from '@/lib/auth'
import { getCampaignMembership } from '@/lib/db/campaignAccess'
import { prisma } from '@/lib/prisma'
import { validateStats } from '@/lib/game/advancement'
import { ensureContactNpcStubs } from '@/lib/wiki/contactNpcStubs'
import { GET, PATCH, DELETE } from '../route'

const db = prisma as any

function getRequest() {
  return new NextRequest('http://localhost/api/campaigns/camp1/characters/char1')
}

function patchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/campaigns/camp1/characters/char1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function deleteRequest() {
  return new NextRequest('http://localhost/api/campaigns/camp1/characters/char1', { method: 'DELETE' })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getUser as any).mockResolvedValue({ userId: 'player1', email: 'player1@example.com' })
  ;(getCampaignMembership as any).mockResolvedValue({ role: 'PLAYER' })
  // GET reads the campaign's advancement ladder alongside the character.
  db.campaign.findUnique.mockResolvedValue({ advancementTrack: null })
})

describe('GET', () => {
  it('rejects a non-member', async () => {
    ;(getCampaignMembership as any).mockResolvedValue(null)
    const response = await GET(getRequest(), { params: { id: 'camp1', characterId: 'char1' } })
    expect(response.status).toBe(403)
  })

  it('404s when the character does not exist', async () => {
    db.character.findUnique.mockResolvedValue(null)
    const response = await GET(getRequest(), { params: { id: 'camp1', characterId: 'char1' } })
    expect(response.status).toBe(404)
  })

  it('lets any campaign member view any character', async () => {
    db.character.findUnique.mockResolvedValue({
      id: 'char1', userId: 'someone-else', name: 'Rowan', capabilities: [], debts: [], factionStandings: [],
    })
    const response = await GET(getRequest(), { params: { id: 'camp1', characterId: 'char1' } })
    expect(response.status).toBe(200)
  })

  it('ships the campaign advancement track so a rank can be placed', async () => {
    // advancementTrack is the CAMPAIGN's and advancementTier is the
    // CHARACTER's; without the ladder in the payload, every consumer renders
    // no progression while looking perfectly healthy — which is exactly how
    // the snapshot modal shipped with no rank on it.
    const track = { tiers: [{ key: 'unranked', label: 'Unranked' }, { key: 'iron', label: 'Iron' }], slotGroups: [] }
    db.campaign.findUnique.mockResolvedValue({ advancementTrack: track })
    db.character.findUnique.mockResolvedValue({
      id: 'char1', userId: 'player1', name: 'Rowan', advancementTier: 'iron',
      capabilities: [], debts: [], factionStandings: [],
    })
    const body = await (await GET(getRequest(), { params: { id: 'camp1', characterId: 'char1' } })).json()
    expect(body.campaign.advancementTrack).toEqual(track)
    expect(body.advancementTier).toBe('iron')
    // Read from the campaign row, not the character row.
    expect(db.campaign.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'camp1' } })
    )
  })

  it('reports a campaign with no ladder as null, not as a missing field', async () => {
    db.campaign.findUnique.mockResolvedValue({ advancementTrack: null })
    db.character.findUnique.mockResolvedValue({
      id: 'char1', userId: 'player1', name: 'Rowan', capabilities: [], debts: [], factionStandings: [],
    })
    const body = await (await GET(getRequest(), { params: { id: 'camp1', characterId: 'char1' } })).json()
    expect(body.campaign).toEqual({ advancementTrack: null })
  })
})

describe('PATCH', () => {
  it('rejects a non-member', async () => {
    ;(getCampaignMembership as any).mockResolvedValue(null)
    const response = await PATCH(patchRequest({ name: 'New Name' }), { params: { id: 'camp1', characterId: 'char1' } })
    expect(response.status).toBe(403)
    expect(db.character.update).not.toHaveBeenCalled()
  })

  it('404s when the character does not exist', async () => {
    db.character.findUnique.mockResolvedValue(null)
    const response = await PATCH(patchRequest({ name: 'New Name' }), { params: { id: 'camp1', characterId: 'char1' } })
    expect(response.status).toBe(404)
  })

  it('rejects a player editing someone else\'s character', async () => {
    db.character.findUnique.mockResolvedValue({ id: 'char1', userId: 'someone-else', resources: {} })
    const response = await PATCH(patchRequest({ name: 'New Name' }), { params: { id: 'camp1', characterId: 'char1' } })
    expect(response.status).toBe(403)
    expect(db.character.update).not.toHaveBeenCalled()
  })

  it('blocks a player from editing a mechanical field on their own character', async () => {
    db.character.findUnique.mockResolvedValue({ id: 'char1', userId: 'player1', resources: {} })
    const response = await PATCH(patchRequest({ harm: 0 }), { params: { id: 'camp1', characterId: 'char1' } })
    expect(response.status).toBe(403)
    expect(db.character.update).not.toHaveBeenCalled()
  })

  it('blocks a player from smuggling a mechanical field in alongside an allowed one', async () => {
    db.character.findUnique.mockResolvedValue({ id: 'char1', userId: 'player1', resources: {} })
    const response = await PATCH(patchRequest({ name: 'New Name', stats: { might: 99 } }), { params: { id: 'camp1', characterId: 'char1' } })
    expect(response.status).toBe(403)
    expect(db.character.update).not.toHaveBeenCalled()
  })

  it('allows a player to edit their own cosmetic fields', async () => {
    db.character.findUnique.mockResolvedValue({ id: 'char1', userId: 'player1', resources: {} })
    db.character.update.mockResolvedValue({ id: 'char1', name: 'New Name' })

    const response = await PATCH(patchRequest({ name: 'New Name', backstory: 'A quiet upbringing.' }), { params: { id: 'camp1', characterId: 'char1' } })

    expect(response.status).toBe(200)
    expect(db.character.update).toHaveBeenCalledWith({
      where: { id: 'char1' },
      data: { name: 'New Name', backstory: 'A quiet upbringing.' },
    })
  })

  it('strips identity fields from the body even for an admin', async () => {
    ;(getCampaignMembership as any).mockResolvedValue({ role: 'ADMIN' })
    db.character.findUnique.mockResolvedValue({ id: 'char1', userId: 'someone-else', resources: {} })
    db.character.update.mockResolvedValue({ id: 'char1' })

    await PATCH(patchRequest({ id: 'different-id', campaignId: 'other-camp', userId: 'attacker', harm: 3 }), { params: { id: 'camp1', characterId: 'char1' } })

    expect(db.character.update).toHaveBeenCalledWith({ where: { id: 'char1' }, data: { harm: 3 } })
  })

  it('lets an admin edit a mechanical field on someone else\'s character', async () => {
    ;(getCampaignMembership as any).mockResolvedValue({ role: 'ADMIN' })
    db.character.findUnique.mockResolvedValue({ id: 'char1', userId: 'someone-else', resources: {} })
    db.character.update.mockResolvedValue({ id: 'char1', harm: 2 })

    const response = await PATCH(patchRequest({ harm: 2 }), { params: { id: 'camp1', characterId: 'char1' } })

    expect(response.status).toBe(200)
    expect(db.character.update).toHaveBeenCalledWith({ where: { id: 'char1' }, data: { harm: 2 } })
  })

  it('validates stats before persisting, and rejects invalid ones', async () => {
    ;(getCampaignMembership as any).mockResolvedValue({ role: 'ADMIN' })
    db.character.findUnique.mockResolvedValue({ id: 'char1', userId: 'player1', resources: {} })
    ;(validateStats as any).mockReturnValue({ valid: false, error: 'total exceeds budget' })

    const response = await PATCH(patchRequest({ stats: { might: 99 } }), { params: { id: 'camp1', characterId: 'char1' } })

    expect(response.status).toBe(400)
    expect(db.character.update).not.toHaveBeenCalled()
  })

  it('creates NPC stubs for newly-added contacts only', async () => {
    ;(getCampaignMembership as any).mockResolvedValue({ role: 'ADMIN' })
    db.character.findUnique.mockResolvedValue({ id: 'char1', userId: 'player1', name: 'Rowan', resources: { contacts: ['Old Friend'] } })
    db.character.update.mockResolvedValue({ id: 'char1' })

    await PATCH(patchRequest({ resources: { contacts: ['Old Friend', 'New Contact'] } }), { params: { id: 'camp1', characterId: 'char1' } })

    expect(ensureContactNpcStubs).toHaveBeenCalledWith('camp1', 'Rowan', ['New Contact'])
  })
})

describe('DELETE', () => {
  it('rejects a non-member', async () => {
    ;(getCampaignMembership as any).mockResolvedValue(null)
    const response = await DELETE(deleteRequest(), { params: { id: 'camp1', characterId: 'char1' } })
    expect(response.status).toBe(403)
    expect(db.character.delete).not.toHaveBeenCalled()
  })

  it('404s when the character does not exist', async () => {
    db.character.findUnique.mockResolvedValue(null)
    const response = await DELETE(deleteRequest(), { params: { id: 'camp1', characterId: 'char1' } })
    expect(response.status).toBe(404)
  })

  it('rejects a player deleting someone else\'s character', async () => {
    db.character.findUnique.mockResolvedValue({ id: 'char1', userId: 'someone-else' })
    const response = await DELETE(deleteRequest(), { params: { id: 'camp1', characterId: 'char1' } })
    expect(response.status).toBe(403)
    expect(db.character.delete).not.toHaveBeenCalled()
  })

  it('lets a player delete their own character', async () => {
    db.character.findUnique.mockResolvedValue({ id: 'char1', userId: 'player1' })
    db.character.delete.mockResolvedValue({ id: 'char1' })
    const response = await DELETE(deleteRequest(), { params: { id: 'camp1', characterId: 'char1' } })
    expect(response.status).toBe(200)
    expect(db.character.delete).toHaveBeenCalledWith({ where: { id: 'char1' } })
  })

  it('lets an admin delete someone else\'s character', async () => {
    ;(getCampaignMembership as any).mockResolvedValue({ role: 'ADMIN' })
    db.character.findUnique.mockResolvedValue({ id: 'char1', userId: 'someone-else' })
    db.character.delete.mockResolvedValue({ id: 'char1' })
    const response = await DELETE(deleteRequest(), { params: { id: 'camp1', characterId: 'char1' } })
    expect(response.status).toBe(200)
  })
})

// #426, found by mutation audit: flipping this route's `status: 401` to
// `status: 200` did not fail a single test, because no test ever set
// getUser to null. The unauthenticated branch — the most basic guarantee
// the route makes — was never executed. Every other assertion in this file
// runs as a signed-in user, so the 401 was structurally unreachable by the
// suite that was said to cover it.
describe('unauthenticated access (#426)', () => {
  it('rejects a caller with no session', async () => {
    ;(getUser as any).mockResolvedValue(null)

    const response = await GET(getRequest(), { params: { id: 'camp1', characterId: 'char1' } })

    expect(response.status).toBe(401)
  })
})
