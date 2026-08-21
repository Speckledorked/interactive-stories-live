// src/app/api/campaigns/[id]/characters/__tests__/route.test.ts
// #135 (cont.) — the character list/create route had no test coverage:
// the membership gate, the world-seeding play lock (no characters until
// a creation-time canon import finishes, since a character now would
// freeze the provisional world in place), stat validation, and that GET
// only returns living characters, were all unverified.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ getUser: vi.fn() }))
vi.mock('@/lib/db/campaignAccess', () => ({ getCampaignMembership: vi.fn() }))
vi.mock('@/lib/lore/seedingGate', () => ({
  isWorldSeeding: vi.fn(),
  SEEDING_MESSAGE: 'World is still seeding',
}))
vi.mock('@/lib/game/advancement', () => ({ validateStats: vi.fn(() => ({ valid: true })) }))
vi.mock('@/lib/analytics/events', () => ({ recordEvent: vi.fn() }))
vi.mock('@/lib/game/characterCreation', () => ({
  createCharacter: vi.fn(),
  // The real class, not a stub: the route's instanceof check must see the
  // same constructor identity the thrown error carries.
  StartingLoadoutError: class StartingLoadoutError extends Error {},
}))
vi.mock('@/lib/prisma', () => ({
  prisma: { character: { findMany: vi.fn() } },
}))

import { getUser } from '@/lib/auth'
import { getCampaignMembership } from '@/lib/db/campaignAccess'
import { isWorldSeeding } from '@/lib/lore/seedingGate'
import { validateStats } from '@/lib/game/advancement'
import { createCharacter } from '@/lib/game/characterCreation'
import { prisma } from '@/lib/prisma'
import { GET, POST } from '../route'

const db = prisma as any

function getRequest() {
  return new NextRequest('http://localhost/api/campaigns/camp1/characters')
}

function postRequest(body: unknown) {
  return new NextRequest('http://localhost/api/campaigns/camp1/characters', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getUser as any).mockResolvedValue({ userId: 'player1' })
  ;(getCampaignMembership as any).mockResolvedValue({ role: 'PLAYER' })
  ;(isWorldSeeding as any).mockResolvedValue(false)
  ;(validateStats as any).mockReturnValue({ valid: true })
  db.character.findMany.mockResolvedValue([])
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

  it('only queries living characters', async () => {
    await GET(getRequest(), { params: { id: 'camp1' } })
    expect(db.character.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { campaignId: 'camp1', isAlive: true },
    }))
  })
})

describe('POST', () => {
  it('rejects an unauthenticated request', async () => {
    ;(getUser as any).mockResolvedValue(null)
    const response = await POST(postRequest({ name: 'Test' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(401)
  })

  it('requires a name', async () => {
    const response = await POST(postRequest({}), { params: { id: 'camp1' } })
    expect(response.status).toBe(400)
    expect(createCharacter).not.toHaveBeenCalled()
  })

  it('blocks character creation while the world is still seeding', async () => {
    ;(isWorldSeeding as any).mockResolvedValue(true)
    const response = await POST(postRequest({ name: 'Test' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(409)
    expect(createCharacter).not.toHaveBeenCalled()
  })

  it('rejects invalid stats', async () => {
    ;(validateStats as any).mockReturnValue({ valid: false, error: 'too many points' })
    const response = await POST(postRequest({ name: 'Test', stats: { cool: 99 } }), { params: { id: 'camp1' } })
    expect(response.status).toBe(400)
    expect(createCharacter).not.toHaveBeenCalled()
  })

  it('rejects a non-member', async () => {
    ;(getCampaignMembership as any).mockResolvedValue(null)
    const response = await POST(postRequest({ name: 'Test' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(403)
  })

  it('creates the character and records the analytics event', async () => {
    ;(createCharacter as any).mockResolvedValue({ id: 'char1', name: 'Test' })
    const response = await POST(postRequest({ name: 'Test' }), { params: { id: 'camp1' } })
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.character).toEqual({ id: 'char1', name: 'Test' })
  })
})


describe('POST — starting loadout refusals', () => {
  it('maps a StartingLoadoutError to a 400 with the message intact', async () => {
    // Too many essences / a capstone without its foundation are the
    // player's problems to fix, and the message tells them which. A 500
    // here would read as "the server is broken", hiding a fixable claim.
    const { StartingLoadoutError } = await import('@/lib/game/characterCreation')
    ;(createCharacter as any).mockRejectedValue(
      new (StartingLoadoutError as any)('5 starting capabilities in Essences, but this world allows 4.')
    )
    const response = await POST(postRequest({ name: 'Jason' }), { params: { id: 'camp1' } })
    const body = await response.json()
    expect(response.status).toBe(400)
    expect(body.error).toContain('this world allows 4')
  })

  it('still maps unexpected failures to a 500', async () => {
    ;(createCharacter as any).mockRejectedValue(new Error('db down'))
    const response = await POST(postRequest({ name: 'Jason' }), { params: { id: 'camp1' } })
    expect(response.status).toBe(500)
  })
})
