// #416: the spend route.
//
// The pure pricing is covered in lib/game/__tests__/spending.test.ts. What
// matters here is everything a route can get wrong with a player's money:
// ownership, the client never naming its own price, double submits, and the
// debit-without-effect failure.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ getUser: vi.fn() }))
vi.mock('@/lib/db/characterAccess', () => ({ requireCharacterOwner: vi.fn() }))
vi.mock('@/lib/rateLimit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rateLimit')>()),
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 19, retryAfterSeconds: 0 })),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn(),
    character: { findUnique: vi.fn(), update: vi.fn() },
    debt: { updateMany: vi.fn(), findMany: vi.fn() },
  },
}))

import { getUser } from '@/lib/auth'
import { requireCharacterOwner } from '@/lib/db/characterAccess'
import { checkRateLimit } from '@/lib/rateLimit'
import { prisma } from '@/lib/prisma'
import { GET, POST } from '../route'

const db = prisma as any

const CHARACTER = {
  id: 'char1',
  campaignId: 'camp1',
  name: 'Sable',
  userId: 'player1',
  harm: 3,
  resources: { gold: 500, items: [] },
}

function req(body?: unknown) {
  return new NextRequest('http://localhost/api/campaigns/camp1/characters/char1/spend', {
    method: body ? 'POST' : 'GET',
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
}

const params = { params: { id: 'camp1', characterId: 'char1' } }

/** Run the route's transaction callback against the mocked tx client. */
function runTransaction(fresh: Record<string, unknown> = CHARACTER) {
  db.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
    db.character.findUnique.mockResolvedValue(fresh)
    return fn(db)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getUser as any).mockResolvedValue({ userId: 'player1' })
  ;(requireCharacterOwner as any).mockResolvedValue({ character: { ...CHARACTER } })
  ;(checkRateLimit as any).mockResolvedValue({ allowed: true, remaining: 19, retryAfterSeconds: 0 })
  db.character.update.mockResolvedValue({})
  db.debt.updateMany.mockResolvedValue({ count: 1 })
  db.debt.findMany.mockResolvedValue([])
  runTransaction()
})

describe('GET', () => {
  it('rejects an unauthenticated caller', async () => {
    ;(getUser as any).mockResolvedValue(null)
    expect((await GET(req(), params)).status).toBe(401)
  })

  it('rejects a character the caller does not own', async () => {
    ;(requireCharacterOwner as any).mockResolvedValue({
      response: new Response(null, { status: 403 }),
    })
    expect((await GET(req(), params)).status).toBe(403)
  })

  it('rejects a character that belongs to a DIFFERENT campaign', async () => {
    // requireCharacterOwner proves ownership, not that the character is in
    // the campaign named in the path. Without this check the campaign id is
    // decorative and a URL from one campaign acts on another.
    ;(requireCharacterOwner as any).mockResolvedValue({
      character: { ...CHARACTER, campaignId: 'other-campaign' },
    })
    expect((await GET(req(), params)).status).toBe(403)
  })

  it('quotes the catalogue against this character’s gold and harm', async () => {
    const body = await (await GET(req(), params)).json()

    expect(body.gold).toBe(500)
    expect(body.offers.map((o: { kind: string }) => o.kind)).toEqual([
      'settle_debt',
      'treat_harm',
      'commission_item',
    ])
    // harm 3 → 80, per the pinned table.
    expect(body.offers.find((o: { kind: string }) => o.kind === 'treat_harm').cost).toBe(80)
  })
})

describe('POST', () => {
  it('refuses a purchase that is not in the catalogue', async () => {
    const response = await POST(req({ kind: 'bribe_the_king' }), params)

    expect(response.status).toBe(400)
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it('ignores a cost supplied by the client (#416)', async () => {
    // The boundary: the client says WHAT it wants, never WHAT IT COSTS.
    // Same shape as reward_grant and harm_healing — a caller-named price is
    // a caller-authored mechanical change.
    const response = await POST(req({ kind: 'treat_harm', cost: 0, price: 0, amount: 0 }), params)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.spent).toBe(80)
    expect(body.gold).toBe(420)
  })

  it('debits the gold and applies the effect in one transaction', async () => {
    await POST(req({ kind: 'treat_harm' }), params)

    // "It took the gold and nothing happened" is the one outcome that must
    // be impossible, so both writes are inside the same $transaction.
    expect(db.$transaction).toHaveBeenCalledTimes(1)
    const harmWrite = db.character.update.mock.calls.find((c: any[]) => 'harm' in c[0].data)
    const goldWrite = db.character.update.mock.calls.find((c: any[]) => 'resources' in c[0].data)
    expect(harmWrite[0].data.harm).toBe(2)
    expect(goldWrite[0].data.resources.gold).toBe(420)
  })

  it('re-checks affordability against a read taken INSIDE the transaction', async () => {
    // The quote is computed from a row fetched before the transaction
    // opens. Two purchases submitted together would otherwise both pass the
    // pre-check and both debit.
    runTransaction({ ...CHARACTER, resources: { gold: 10, items: [] } })

    const response = await POST(req({ kind: 'treat_harm' }), params)

    expect(response.status).toBe(400)
    expect(db.character.update).not.toHaveBeenCalled()
  })

  it('refuses to spend more than the character has', async () => {
    ;(requireCharacterOwner as any).mockResolvedValue({
      character: { ...CHARACTER, resources: { gold: 1 } },
    })

    const response = await POST(req({ kind: 'settle_debt', debtId: 'd1' }), params)

    expect(response.status).toBe(400)
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  describe('settle_debt', () => {
    it('settles only an OUTSTANDING debt this character owes', async () => {
      await POST(req({ kind: 'settle_debt', debtId: 'd1' }), params)

      // The predicate is the whole guard: id alone would let a player settle
      // someone else's favor, or one owed TO them.
      expect(db.debt.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'd1',
            characterId: 'char1',
            status: 'OUTSTANDING',
            direction: 'OWED_BY_CHARACTER',
          },
        })
      )
    })

    it('is a no-op on a double submit rather than a second payment', async () => {
      db.debt.updateMany.mockResolvedValue({ count: 0 })

      const response = await POST(req({ kind: 'settle_debt', debtId: 'd1' }), params)

      expect(response.status).toBe(400)
      expect(db.character.update).not.toHaveBeenCalled()
    })

    it('requires a debt to be named', async () => {
      expect((await POST(req({ kind: 'settle_debt' }), params)).status).toBe(400)
    })
  })

  describe('commission_item', () => {
    it('adds the item priced by the engine, not by the request', async () => {
      const response = await POST(
        req({ kind: 'commission_item', rarity: 'rare', name: 'Ashsteel blade', value: 999_999 }),
        params
      )

      expect(response.status).toBe(200)
      const write = db.character.update.mock.calls.find((c: any[]) => 'resources' in c[0].data)
      const item = write[0].data.resources.items[0]
      expect(item.name).toBe('Ashsteel blade')
      // 500 — the rare tier's rate — not the 999,999 the caller asked for.
      expect(item.value).toBe(500)
      expect(write[0].data.resources.gold).toBe(0)
    })

    it('will not sell legendary', async () => {
      const response = await POST(
        req({ kind: 'commission_item', rarity: 'legendary', name: 'The Ashen Crown' }),
        params
      )

      expect(response.status).toBe(400)
      expect(db.$transaction).not.toHaveBeenCalled()
    })

    it('requires a name', async () => {
      expect((await POST(req({ kind: 'commission_item', rarity: 'common' }), params)).status).toBe(400)
    })
  })

  it('is rate limited', async () => {
    ;(checkRateLimit as any).mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 30 })

    const response = await POST(req({ kind: 'treat_harm' }), params)

    expect(response.status).toBe(429)
    expect(db.$transaction).not.toHaveBeenCalled()
  })
})
