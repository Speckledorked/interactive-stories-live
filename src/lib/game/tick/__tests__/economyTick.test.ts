import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    factionDebt: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn(), create: vi.fn(), createMany: vi.fn() },
    faction: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    activeWake: { create: vi.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import { decideLoanExtension, decideDefaultCascade, tickEconomy } from '../economyTick'
import type { TickContext } from '../types'
import { factionTieRows } from './tieFixtures'

function baseCtx(overrides: Partial<TickContext> = {}): TickContext {
  return { campaignId: 'campaign-1', turnNumber: 10, factionCap: 10, npcCap: 20, dryRun: false, db: prisma as any, ...overrides }
}

describe('decideLoanExtension (#111)', () => {
  it('returns null when the "broke" faction is not actually below the threshold', () => {
    expect(decideLoanExtension({ factionId: 'f1', resources: 50 }, [{ factionId: 'f2', resources: 90 }])).toBeNull()
  })

  it('returns null when no lender meets the minimum resource bar', () => {
    expect(decideLoanExtension({ factionId: 'f1', resources: 10 }, [{ factionId: 'f2', resources: 40 }])).toBeNull()
  })

  it('returns null with no candidate lenders at all', () => {
    expect(decideLoanExtension({ factionId: 'f1', resources: 10 }, [])).toBeNull()
  })

  it('extends a loan from a capable ally, amount capped at the same ceiling a quest payout respects', () => {
    const decision = decideLoanExtension({ factionId: 'f1', resources: 10 }, [{ factionId: 'ally1', resources: 80 }])
    expect(decision).toEqual({ lenderFactionId: 'ally1', amount: 15 })
  })

  it('picks the richest capable lender when several qualify', () => {
    const decision = decideLoanExtension({ factionId: 'f1', resources: 10 }, [
      { factionId: 'poor-ally', resources: 61 },
      { factionId: 'rich-ally', resources: 95 },
    ])
    expect(decision?.lenderFactionId).toBe('rich-ally')
  })

  it('breaks ties between equally-rich lenders by id', () => {
    const decision = decideLoanExtension({ factionId: 'f1', resources: 10 }, [
      { factionId: 'b-ally', resources: 80 },
      { factionId: 'a-ally', resources: 80 },
    ])
    expect(decision?.lenderFactionId).toBe('a-ally')
  })

  it('is deterministic for the same input', () => {
    const input: [any, any] = [{ factionId: 'f1', resources: 10 }, [{ factionId: 'ally1', resources: 80 }]]
    expect(decideLoanExtension(...input)).toEqual(decideLoanExtension(...input))
  })
})

describe('decideDefaultCascade (#111)', () => {
  it('scales with the number of defaulted debts', () => {
    const one = decideDefaultCascade(1, 0)
    const three = decideDefaultCascade(3, 0)
    expect(three).toBeLessThan(one) // more negative
  })

  it('scales with roughness', () => {
    const smooth = decideDefaultCascade(1, 0)
    const rough = decideDefaultCascade(1, 1)
    expect(rough).toBeLessThan(smooth)
  })

  it('never exceeds the hard cap regardless of how many debts default at once', () => {
    expect(decideDefaultCascade(50, 1)).toBe(-15)
  })

  it('defaults roughness to a neutral fallback when omitted', () => {
    expect(decideDefaultCascade(1)).toBe(decideDefaultCascade(1, 0.4))
  })

  it('always returns a non-positive value', () => {
    expect(decideDefaultCascade(1, 0)).toBeLessThanOrEqual(0)
  })
})

describe('tickEconomy (DB handler)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // #441: the loan write is createMany + skipDuplicates now (ON CONFLICT
    // DO NOTHING), so the default is "inserted one row".
    vi.mocked(prisma.factionDebt.createMany).mockResolvedValue({ count: 1 } as any)
  })

  it('does nothing when there are no outstanding debts and no broke factions', async () => {
    vi.mocked(prisma.factionDebt.findMany).mockResolvedValueOnce([])
    vi.mocked(prisma.faction.findMany).mockResolvedValueOnce([])

    const result = await tickEconomy(baseCtx())

    expect(result.changes).toEqual([])
  })

  it('defaults an outstanding debt whose debtor has collapsed', async () => {
    vi.mocked(prisma.factionDebt.findMany).mockResolvedValueOnce([
      { id: 'debt1', creditorFactionId: 'creditor1', debtorFactionId: 'debtor1' },
    ] as any)
    vi.mocked(prisma.faction.findMany)
      .mockResolvedValueOnce([{ id: 'debtor1', isActive: false, resources: 50 }] as any) // debtors lookup
      .mockResolvedValueOnce([]) // broke-factions query (step 2)
    vi.mocked(prisma.faction.findUnique).mockResolvedValueOnce({
      id: 'creditor1', name: 'Ashcrown', stability: 50, isActive: true,
    } as any)

    const result = await tickEconomy(baseCtx())

    expect(prisma.factionDebt.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['debt1'] } },
      data: expect.objectContaining({ status: 'DEFAULTED' }),
    })
    expect(prisma.activeWake.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ sourceType: 'FACTION_DEFAULT', affectedFactionId: 'creditor1' }),
    })
    expect(prisma.faction.update).toHaveBeenCalledWith({ where: { id: 'creditor1' }, data: { stability: expect.any(Number) } })
    expect(result.changes).toHaveLength(1)
    // #310: this cascade must NOT carry the same discriminator a genuine
    // NPC-death/faction-collapse wake does — npcDispositionTick.ts/
    // beliefTick.ts both now branch on this to avoid misreading an ally's
    // loan default as institutional-memory-loss abandonment.
    expect(result.changes[0]).toMatchObject({ entityType: 'FACTION', entityId: 'creditor1', field: 'stability', origin: 'wake', wakeSourceType: 'FACTION_DEFAULT' })
  })

  it('defaults an outstanding debt whose debtor is still active but broke', async () => {
    vi.mocked(prisma.factionDebt.findMany).mockResolvedValueOnce([
      { id: 'debt1', creditorFactionId: 'creditor1', debtorFactionId: 'debtor1' },
    ] as any)
    vi.mocked(prisma.faction.findMany)
      .mockResolvedValueOnce([{ id: 'debtor1', isActive: true, resources: 10 }] as any)
      .mockResolvedValueOnce([])
    vi.mocked(prisma.faction.findUnique).mockResolvedValueOnce({
      id: 'creditor1', name: 'Ashcrown', stability: 50, isActive: true,
    } as any)

    const result = await tickEconomy(baseCtx())

    expect(prisma.factionDebt.updateMany).toHaveBeenCalled()
    expect(result.changes).toHaveLength(1)
  })

  it('does not default a debt whose debtor remains active and solvent', async () => {
    vi.mocked(prisma.factionDebt.findMany).mockResolvedValueOnce([
      { id: 'debt1', creditorFactionId: 'creditor1', debtorFactionId: 'debtor1' },
    ] as any)
    vi.mocked(prisma.faction.findMany)
      .mockResolvedValueOnce([{ id: 'debtor1', isActive: true, resources: 60 }] as any)
      .mockResolvedValueOnce([])

    const result = await tickEconomy(baseCtx())

    expect(prisma.factionDebt.updateMany).not.toHaveBeenCalled()
    expect(result.changes).toEqual([])
  })

  it('excludes debts created THIS same turn from default-eligibility', async () => {
    vi.mocked(prisma.factionDebt.findMany).mockResolvedValueOnce([])
    vi.mocked(prisma.faction.findMany).mockResolvedValueOnce([])
    await tickEconomy(baseCtx({ turnNumber: 10 }))
    expect(prisma.factionDebt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ turnCreated: { lt: 10 } }) })
    )
  })

  it('skips cascading to a creditor that has itself since collapsed', async () => {
    vi.mocked(prisma.factionDebt.findMany).mockResolvedValueOnce([
      { id: 'debt1', creditorFactionId: 'creditor1', debtorFactionId: 'debtor1' },
    ] as any)
    vi.mocked(prisma.faction.findMany)
      .mockResolvedValueOnce([{ id: 'debtor1', isActive: false, resources: 50 }] as any)
      .mockResolvedValueOnce([])
    vi.mocked(prisma.faction.findUnique).mockResolvedValueOnce({
      id: 'creditor1', name: 'Ashcrown', stability: 50, isActive: false,
    } as any)

    const result = await tickEconomy(baseCtx())

    expect(prisma.faction.update).not.toHaveBeenCalled()
    expect(result.changes).toEqual([])
  })

  it('originates a loan from a healthy ally to a broke faction', async () => {
    vi.mocked(prisma.factionDebt.findMany).mockResolvedValueOnce([]) // no outstanding debts
    vi.mocked(prisma.faction.findMany)
      .mockResolvedValueOnce([
        { id: 'broke1', name: 'Struggling Co', resources: 10, ...factionTieRows('broke1', { ally1: { type: 'ALLY', since: 1 } }) },
      ] as any) // broke factions
      .mockResolvedValueOnce([{ id: 'ally1', name: 'Wealthy Co', resources: 90 }] as any) // allies lookup
    vi.mocked(prisma.factionDebt.findFirst).mockResolvedValueOnce(null) // no existing debt

    const result = await tickEconomy(baseCtx())

    expect(prisma.factionDebt.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ creditorFactionId: 'ally1', debtorFactionId: 'broke1', amount: 15, turnCreated: 10 })],
      skipDuplicates: true,
    })
    expect(prisma.faction.update).toHaveBeenCalledWith({ where: { id: 'ally1' }, data: { resources: 75 } })
    expect(prisma.faction.update).toHaveBeenCalledWith({ where: { id: 'broke1' }, data: { resources: 25 } })
    expect(result.changes).toHaveLength(1)
    expect(result.changes[0]).toMatchObject({ entityId: 'broke1', field: 'resources' })
  })

  it('#238/#441: never lets the single-outstanding-debt backstop raise inside the tick transaction', async () => {
    // The rare window this backstops: the findFirst check above and the
    // write below it are two separate statements, and the partial unique
    // index is what actually enforces the invariant if they ever race.
    //
    // This test used to assert that a raised P2002 was CAUGHT, on the
    // stated reasoning that "an uncaught P2002 here would abort
    // runWorldTick's entire transaction, so this must be caught". The
    // premise was right and the conclusion did not follow: by the time the
    // catch runs, the statement has ALREADY aborted the transaction.
    // Postgres does not un-abort on catch and Prisma opens no savepoint, so
    // every later handler failed with "current transaction is aborted".
    // Catching converted a benign collision into a lost world turn.
    //
    // So what is asserted now is that it cannot raise at all:
    // createMany + skipDuplicates compiles to ON CONFLICT DO NOTHING.
    vi.mocked(prisma.factionDebt.findMany).mockResolvedValueOnce([])
    vi.mocked(prisma.faction.findMany)
      .mockResolvedValueOnce([
        { id: 'broke1', name: 'Struggling Co', resources: 10, ...factionTieRows('broke1', { ally1: { type: 'ALLY', since: 1 } }) },
      ] as any)
      .mockResolvedValueOnce([{ id: 'ally1', name: 'Wealthy Co', resources: 90 }] as any)
    vi.mocked(prisma.factionDebt.findFirst).mockResolvedValueOnce(null)
    // The collision: the row already existed, so nothing was inserted.
    vi.mocked(prisma.factionDebt.createMany).mockResolvedValueOnce({ count: 0 } as any)

    const result = await tickEconomy(baseCtx())

    expect(prisma.factionDebt.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true })
    )
    // Nothing raised, and the loan's follow-up writes correctly did not run.
    expect(prisma.faction.update).not.toHaveBeenCalled()
    expect(result.changes).toEqual([])
  })

  it('re-throws a non-constraint error from the FactionDebt create rather than silently swallowing it', async () => {
    vi.mocked(prisma.factionDebt.findMany).mockResolvedValueOnce([])
    vi.mocked(prisma.faction.findMany)
      .mockResolvedValueOnce([
        { id: 'broke1', name: 'Struggling Co', resources: 10, ...factionTieRows('broke1', { ally1: { type: 'ALLY', since: 1 } }) },
      ] as any)
      .mockResolvedValueOnce([{ id: 'ally1', name: 'Wealthy Co', resources: 90 }] as any)
    vi.mocked(prisma.factionDebt.findFirst).mockResolvedValueOnce(null)
    vi.mocked(prisma.factionDebt.createMany).mockRejectedValueOnce(new Error('connection reset'))

    await expect(tickEconomy(baseCtx())).rejects.toThrow('connection reset')
  })

  it('does not originate a second loan while one is already outstanding', async () => {
    vi.mocked(prisma.factionDebt.findMany).mockResolvedValueOnce([])
    vi.mocked(prisma.faction.findMany).mockResolvedValueOnce([
      { id: 'broke1', name: 'Struggling Co', resources: 10, ...factionTieRows('broke1', { ally1: { type: 'ALLY', since: 1 } }) },
    ] as any)
    vi.mocked(prisma.factionDebt.findFirst).mockResolvedValueOnce({ id: 'existing-debt' } as any)

    const result = await tickEconomy(baseCtx())

    expect(prisma.factionDebt.create).not.toHaveBeenCalled()
    expect(result.changes).toEqual([])
  })

  // #311: a debtor whose debt just defaulted (flipping OUTSTANDING ->
  // DEFAULTED, never removing the row) used to pass the old
  // OUTSTANDING-only existing-debt check and immediately re-borrow — in
  // the same tick, from any still-solvent ally, frequently the very
  // creditor it just stiffed (the cascade penalty only ever hits the
  // creditor's stability, never the debtor's own resources). The
  // existing-debt query itself must now also exclude a recent DEFAULTED
  // debt, not just an OUTSTANDING one.
  it('#311: the existing-debt query excludes both OUTSTANDING and a recently-DEFAULTED debt', async () => {
    vi.mocked(prisma.factionDebt.findMany).mockResolvedValueOnce([])
    vi.mocked(prisma.faction.findMany).mockResolvedValueOnce([
      { id: 'broke1', name: 'Struggling Co', resources: 10, ...factionTieRows('broke1', { ally1: { type: 'ALLY', since: 1 } }) },
    ] as any)
    vi.mocked(prisma.factionDebt.findFirst).mockResolvedValueOnce(null)
    vi.mocked(prisma.faction.findMany).mockResolvedValueOnce([]) // no allies reached — findFirst is what's under test

    await tickEconomy(baseCtx({ turnNumber: 10 }))

    expect(prisma.factionDebt.findFirst).toHaveBeenCalledWith({
      where: {
        campaignId: 'campaign-1',
        debtorFactionId: 'broke1',
        OR: [
          { status: 'OUTSTANDING' },
          { status: 'DEFAULTED', turnResolved: { gte: 5 } }, // turnNumber(10) - cooldown(5)
          // #418: a DEFAULTED row with a NULL turnResolved was silently
          // excluded — SQL comparisons against NULL are never true — so a
          // legacy defaulter re-qualified for a bailout loan immediately,
          // the opposite of what a cooldown is for.
          { status: 'DEFAULTED', turnResolved: null },
        ],
      },
      select: { id: true },
    })
  })

  it('#311: does not originate a new loan for a debtor that defaulted within the cooldown window', async () => {
    vi.mocked(prisma.factionDebt.findMany).mockResolvedValueOnce([])
    vi.mocked(prisma.faction.findMany).mockResolvedValueOnce([
      { id: 'broke1', name: 'Struggling Co', resources: 10, ...factionTieRows('broke1', { ally1: { type: 'ALLY', since: 1 } }) },
    ] as any)
    // Simulates the DB actually finding the recent DEFAULTED row the OR
    // clause above is meant to catch.
    vi.mocked(prisma.factionDebt.findFirst).mockResolvedValueOnce({ id: 'defaulted-debt' } as any)

    const result = await tickEconomy(baseCtx())

    expect(prisma.factionDebt.create).not.toHaveBeenCalled()
    expect(result.changes).toEqual([])
  })

  it('#311: a debtor whose last default is now outside the cooldown window is eligible again', async () => {
    vi.mocked(prisma.factionDebt.findMany).mockResolvedValueOnce([])
    vi.mocked(prisma.faction.findMany)
      .mockResolvedValueOnce([
        { id: 'broke1', name: 'Struggling Co', resources: 10, ...factionTieRows('broke1', { ally1: { type: 'ALLY', since: 1 } }) },
      ] as any)
      .mockResolvedValueOnce([{ id: 'ally1', name: 'Wealthy Co', resources: 90 }] as any)
    // The real query (not asserted here) would exclude this row on its
    // own — this test only pins the behavior once findFirst legitimately
    // returns null (old default aged out), not the query shape itself.
    vi.mocked(prisma.factionDebt.findFirst).mockResolvedValueOnce(null)

    const result = await tickEconomy(baseCtx())

    expect(prisma.factionDebt.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ creditorFactionId: 'ally1', debtorFactionId: 'broke1' })],
      skipDuplicates: true,
    })
    expect(result.changes).toHaveLength(1)
  })

  it('does not originate a loan when the broke faction has no ally at all', async () => {
    vi.mocked(prisma.factionDebt.findMany).mockResolvedValueOnce([])
    vi.mocked(prisma.faction.findMany).mockResolvedValueOnce([
      { id: 'broke1', name: 'Struggling Co', resources: 10, ...factionTieRows('broke1', {}) },
    ] as any)
    vi.mocked(prisma.factionDebt.findFirst).mockResolvedValueOnce(null)

    const result = await tickEconomy(baseCtx())

    expect(prisma.factionDebt.create).not.toHaveBeenCalled()
    expect(result.changes).toEqual([])
  })

  it('writes nothing in dry-run mode but still reports the changes', async () => {
    vi.mocked(prisma.factionDebt.findMany).mockResolvedValueOnce([])
    vi.mocked(prisma.faction.findMany)
      .mockResolvedValueOnce([
        { id: 'broke1', name: 'Struggling Co', resources: 10, ...factionTieRows('broke1', { ally1: { type: 'ALLY', since: 1 } }) },
      ] as any)
      .mockResolvedValueOnce([{ id: 'ally1', name: 'Wealthy Co', resources: 90 }] as any)
    vi.mocked(prisma.factionDebt.findFirst).mockResolvedValueOnce(null)

    const result = await tickEconomy(baseCtx({ dryRun: true }))

    expect(prisma.factionDebt.create).not.toHaveBeenCalled()
    expect(prisma.faction.update).not.toHaveBeenCalled()
    expect(result.changes).toHaveLength(1)
  })

  // ---- #371: cancelling debt that runs in a circle -----------------------
  //
  // Netting is the only route by which a FactionDebt can leave this system
  // without someone collapsing — nothing else in the codebase has ever
  // written PAID.

  it('settles a mutual debt against itself and marks the smaller one PAID', async () => {
    vi.mocked(prisma.factionDebt.findMany).mockResolvedValueOnce([
      { id: 'aOwesB', creditorFactionId: 'b', debtorFactionId: 'a', amount: 8 },
      { id: 'bOwesA', creditorFactionId: 'a', debtorFactionId: 'b', amount: 3 },
    ] as any)
    vi.mocked(prisma.faction.findMany)
      .mockResolvedValueOnce([
        { id: 'b', name: 'Ashcrown' },
        { id: 'a', name: 'Verdant Pact' },
      ] as any) // creditor names for the netting changes
      .mockResolvedValueOnce([]) // debtors lookup (nothing left to default)
      .mockResolvedValueOnce([]) // broke-factions query (step 2)

    const result = await tickEconomy(baseCtx())

    // The smaller obligation is gone entirely...
    expect(prisma.factionDebt.update).toHaveBeenCalledWith({
      where: { id: 'bOwesA' },
      data: expect.objectContaining({ status: 'PAID', amount: 0 }),
    })
    // ...and the larger one is reduced by the same amount, not settled.
    expect(prisma.factionDebt.update).toHaveBeenCalledWith({
      where: { id: 'aOwesB' },
      data: { amount: 5 },
    })
    expect(result.changes).toHaveLength(2)
  })

  it('does not default a debt that netting already settled this pass', async () => {
    // Ordering is the whole point: the debtor here is collapsed, so under
    // the old sequence this debt would have defaulted and put a stability
    // shockwave through its creditor. Netting runs first and cancels it
    // against the circle instead, which is the outcome that costs nobody
    // anything.
    vi.mocked(prisma.factionDebt.findMany).mockResolvedValueOnce([
      { id: 'aOwesB', creditorFactionId: 'b', debtorFactionId: 'a', amount: 10 },
      { id: 'bOwesA', creditorFactionId: 'a', debtorFactionId: 'b', amount: 10 },
    ] as any)
    vi.mocked(prisma.faction.findMany)
      .mockResolvedValueOnce([
        { id: 'b', name: 'Ashcrown' },
        { id: 'a', name: 'Verdant Pact' },
      ] as any)
      .mockResolvedValueOnce([]) // no debtors left to look up
      .mockResolvedValueOnce([])

    await tickEconomy(baseCtx())

    // Both settled by netting, so nothing reaches the defaulting path.
    expect(prisma.factionDebt.updateMany).not.toHaveBeenCalled()
    expect(prisma.activeWake.create).not.toHaveBeenCalled()
  })

  it('leaves an acyclic debt graph untouched', async () => {
    vi.mocked(prisma.factionDebt.findMany).mockResolvedValueOnce([
      { id: 'd1', creditorFactionId: 'b', debtorFactionId: 'a', amount: 10 },
      { id: 'd2', creditorFactionId: 'c', debtorFactionId: 'b', amount: 4 },
    ] as any)
    vi.mocked(prisma.faction.findMany)
      .mockResolvedValueOnce([{ id: 'a', isActive: true, resources: 80 }, { id: 'b', isActive: true, resources: 80 }] as any)
      .mockResolvedValueOnce([])

    await tickEconomy(baseCtx())

    expect(prisma.factionDebt.update).not.toHaveBeenCalled()
  })

  it('writes no netting in dry-run mode but still reports it', async () => {
    vi.mocked(prisma.factionDebt.findMany).mockResolvedValueOnce([
      { id: 'aOwesB', creditorFactionId: 'b', debtorFactionId: 'a', amount: 6 },
      { id: 'bOwesA', creditorFactionId: 'a', debtorFactionId: 'b', amount: 6 },
    ] as any)
    vi.mocked(prisma.faction.findMany)
      .mockResolvedValueOnce([{ id: 'b', name: 'Ashcrown' }, { id: 'a', name: 'Verdant Pact' }] as any)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    const result = await tickEconomy(baseCtx({ dryRun: true }))

    expect(prisma.factionDebt.update).not.toHaveBeenCalled()
    expect(result.changes).toHaveLength(2)
  })
})
