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
import { simTurn } from '@/lib/game/turnClock'

function baseCtx(overrides: Partial<TickContext> = {}): TickContext {
  return { campaignId: 'campaign-1', turnNumber: simTurn(10), factionCap: 10, npcCap: 20, dryRun: false, db: prisma as any, ...overrides }
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
    expect(decision).toEqual({ lenderFactionId: 'ally1', amount: 30 })
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

  /**
   * tickEconomy issues several faction.findMany calls per pass with
   * different select shapes; dispatching on the shape keeps these tests
   * independent of the handler's internal query order.
   * - debtors: the default-eligibility lookup (selects influence)
   * - names: id+name lookups (netting participants, defaulter names)
   * - resources: id+name+resources lookups (repayment parties, loan allies)
   * - broke: the broke-faction scan (filters on resources)
   */
  function mockFactionQueries(handlers: { debtors?: any[]; names?: any[]; resources?: any[]; broke?: any[] }) {
    vi.mocked(prisma.faction.findMany).mockImplementation((async (args: any) => {
      const select = args?.select ?? {}
      const where = args?.where ?? {}
      if (select.influence !== undefined) return (handlers.debtors ?? []) as any
      if (where.resources !== undefined) return (handlers.broke ?? []) as any
      if (select.resources !== undefined) return (handlers.resources ?? []) as any
      return (handlers.names ?? []) as any
    }) as any)
  }

  it('does nothing when there are no outstanding debts and no broke factions', async () => {
    vi.mocked(prisma.factionDebt.findMany).mockResolvedValueOnce([])
    mockFactionQueries({})

    const result = await tickEconomy(baseCtx())

    expect(result.changes).toEqual([])
  })

  it('defaults an outstanding debt whose debtor has collapsed', async () => {
    vi.mocked(prisma.factionDebt.findMany).mockResolvedValueOnce([
      { id: 'debt1', creditorFactionId: 'creditor1', debtorFactionId: 'debtor1', amount: 20, turnCreated: 5 },
    ] as any)
    mockFactionQueries({
      debtors: [{ id: 'debtor1', isActive: false, resources: 50, influence: 40 }], // debtors lookup
      names: [{ id: 'debtor1', name: 'Fallen Guild' }], // defaulter names
      broke: [], // broke-factions query (step 2)
    })
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
      { id: 'debt1', creditorFactionId: 'creditor1', debtorFactionId: 'debtor1', amount: 20, turnCreated: 5 },
    ] as any)
    mockFactionQueries({
      debtors: [{ id: 'debtor1', isActive: true, resources: 10, influence: 40 }],
      names: [{ id: 'debtor1', name: 'Broke Guild' }],
      broke: [],
    })
    vi.mocked(prisma.faction.findUnique).mockResolvedValueOnce({
      id: 'creditor1', name: 'Ashcrown', stability: 50, isActive: true,
    } as any)

    const result = await tickEconomy(baseCtx())

    expect(prisma.factionDebt.updateMany).toHaveBeenCalled()
    expect(result.changes).toHaveLength(2) // creditor stability shock + debtor influence penalty
  })

  it('does not default a debt whose debtor remains active and solvent', async () => {
    vi.mocked(prisma.factionDebt.findMany).mockResolvedValueOnce([
      { id: 'debt1', creditorFactionId: 'creditor1', debtorFactionId: 'debtor1', amount: 20, turnCreated: 5 },
    ] as any)
    mockFactionQueries({
      // Solvent: no default, but healthy enough to service the debt —
      // the repayment step below picks it up.
      debtors: [{ id: 'debtor1', isActive: true, resources: 60, influence: 40 }],
      resources: [
        { id: 'debtor1', name: 'Solvent Guild', resources: 60 },
        { id: 'creditor1', name: 'Ashcrown', resources: 50 },
      ],
      broke: [],
    })

    const result = await tickEconomy(baseCtx())

    expect(prisma.factionDebt.updateMany).not.toHaveBeenCalled()
    // No default — but the solvent debtor repays an installment, which is
    // three real changes: the obligation shrinks, and resources move both
    // ways (the treasury classifier reads resources events, not debt ones).
    expect(result.changes).toHaveLength(3)
    expect(result.changes[0]).toMatchObject({ field: 'debt', newValue: 10 })
    const resourcesChanges = result.changes.filter((c) => c.field === 'resources')
    expect(resourcesChanges).toHaveLength(2)
    expect(resourcesChanges).toContainEqual(
      expect.objectContaining({ entityId: 'debtor1', previousValue: 60, newValue: 50 })
    )
    expect(resourcesChanges).toContainEqual(
      expect.objectContaining({ entityId: 'creditor1', previousValue: 50, newValue: 60 })
    )
  })

  it('excludes debts created THIS same turn from default-eligibility', async () => {
    vi.mocked(prisma.factionDebt.findMany).mockResolvedValueOnce([])
    mockFactionQueries({})
    await tickEconomy(baseCtx({ turnNumber: simTurn(10) }))
    expect(prisma.factionDebt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ turnCreated: { lt: 10 } }) })
    )
  })

  it('skips cascading to a creditor that has itself since collapsed', async () => {
    vi.mocked(prisma.factionDebt.findMany).mockResolvedValueOnce([
      { id: 'debt1', creditorFactionId: 'creditor1', debtorFactionId: 'debtor1', amount: 20, turnCreated: 5 },
    ] as any)
    mockFactionQueries({
      debtors: [{ id: 'debtor1', isActive: false, resources: 50, influence: 40 }],
      names: [{ id: 'debtor1', name: 'Fallen Guild' }],
      broke: [],
    })
    vi.mocked(prisma.faction.findUnique).mockResolvedValueOnce({
      id: 'creditor1', name: 'Ashcrown', stability: 50, isActive: false,
    } as any)

    const result = await tickEconomy(baseCtx())

    expect(prisma.faction.update).not.toHaveBeenCalled()
    expect(result.changes).toEqual([])
  })

  it('originates a loan from a healthy ally to a broke faction', async () => {
    vi.mocked(prisma.factionDebt.findMany).mockResolvedValueOnce([]) // no outstanding debts
    mockFactionQueries({
      broke: [
        { id: 'broke1', name: 'Struggling Co', resources: 10, ...factionTieRows('broke1', { ally1: { type: 'ALLY', since: 1 } }) },
      ],
      resources: [{ id: 'ally1', name: 'Wealthy Co', resources: 90 }], // allies lookup
    })
    vi.mocked(prisma.factionDebt.findFirst).mockResolvedValueOnce(null) // no existing debt

    const result = await tickEconomy(baseCtx())

    expect(prisma.factionDebt.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ creditorFactionId: 'ally1', debtorFactionId: 'broke1', amount: 30, turnCreated: 10 })],
      skipDuplicates: true,
    })
    expect(prisma.faction.update).toHaveBeenCalledWith({ where: { id: 'ally1' }, data: { resources: 60 } })
    expect(prisma.faction.update).toHaveBeenCalledWith({ where: { id: 'broke1' }, data: { resources: 40 } })
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
    mockFactionQueries({
      broke: [
        { id: 'broke1', name: 'Struggling Co', resources: 10, ...factionTieRows('broke1', { ally1: { type: 'ALLY', since: 1 } }) },
      ],
      resources: [{ id: 'ally1', name: 'Wealthy Co', resources: 90 }],
    })
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
    mockFactionQueries({
      broke: [
        { id: 'broke1', name: 'Struggling Co', resources: 10, ...factionTieRows('broke1', { ally1: { type: 'ALLY', since: 1 } }) },
      ],
      resources: [{ id: 'ally1', name: 'Wealthy Co', resources: 90 }],
    })
    vi.mocked(prisma.factionDebt.findFirst).mockResolvedValueOnce(null)
    vi.mocked(prisma.factionDebt.createMany).mockRejectedValueOnce(new Error('connection reset'))

    await expect(tickEconomy(baseCtx())).rejects.toThrow('connection reset')
  })

  it('does not originate a second loan while one is already outstanding', async () => {
    vi.mocked(prisma.factionDebt.findMany).mockResolvedValueOnce([])
    mockFactionQueries({
      broke: [
        { id: 'broke1', name: 'Struggling Co', resources: 10, ...factionTieRows('broke1', { ally1: { type: 'ALLY', since: 1 } }) },
      ],
    })
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
    mockFactionQueries({
      broke: [
        { id: 'broke1', name: 'Struggling Co', resources: 10, ...factionTieRows('broke1', { ally1: { type: 'ALLY', since: 1 } }) },
      ],
      resources: [], // no allies reached — findFirst is what's under test
    })
    vi.mocked(prisma.factionDebt.findFirst).mockResolvedValueOnce(null)

    await tickEconomy(baseCtx({ turnNumber: simTurn(10) }))

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
    mockFactionQueries({
      broke: [
        { id: 'broke1', name: 'Struggling Co', resources: 10, ...factionTieRows('broke1', { ally1: { type: 'ALLY', since: 1 } }) },
      ],
    })
    // Simulates the DB actually finding the recent DEFAULTED row the OR
    // clause above is meant to catch.
    vi.mocked(prisma.factionDebt.findFirst).mockResolvedValueOnce({ id: 'defaulted-debt' } as any)

    const result = await tickEconomy(baseCtx())

    expect(prisma.factionDebt.create).not.toHaveBeenCalled()
    expect(result.changes).toEqual([])
  })

  it('#311: a debtor whose last default is now outside the cooldown window is eligible again', async () => {
    vi.mocked(prisma.factionDebt.findMany).mockResolvedValueOnce([])
    mockFactionQueries({
      broke: [
        { id: 'broke1', name: 'Struggling Co', resources: 10, ...factionTieRows('broke1', { ally1: { type: 'ALLY', since: 1 } }) },
      ],
      resources: [{ id: 'ally1', name: 'Wealthy Co', resources: 90 }],
    })
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
    mockFactionQueries({
      broke: [
        { id: 'broke1', name: 'Struggling Co', resources: 10, ...factionTieRows('broke1', {}) },
      ],
    })
    vi.mocked(prisma.factionDebt.findFirst).mockResolvedValueOnce(null)

    const result = await tickEconomy(baseCtx())

    expect(prisma.factionDebt.create).not.toHaveBeenCalled()
    expect(result.changes).toEqual([])
  })

  it('writes nothing in dry-run mode but still reports the changes', async () => {
    vi.mocked(prisma.factionDebt.findMany).mockResolvedValueOnce([])
    mockFactionQueries({
      broke: [
        { id: 'broke1', name: 'Struggling Co', resources: 10, ...factionTieRows('broke1', { ally1: { type: 'ALLY', since: 1 } }) },
      ],
      resources: [{ id: 'ally1', name: 'Wealthy Co', resources: 90 }],
    })
    vi.mocked(prisma.factionDebt.findFirst).mockResolvedValueOnce(null)

    const result = await tickEconomy(baseCtx({ dryRun: true }))

    expect(prisma.factionDebt.create).not.toHaveBeenCalled()
    expect(prisma.faction.update).not.toHaveBeenCalled()
    expect(result.changes).toHaveLength(1)
  })

  // ---- #371: cancelling debt that runs in a circle -----------------------
  //
  // Netting settles what it can against a circle; repayment clears the
  // rest when the debtor is healthy. (The "nothing else has ever written
  // PAID" era ended when debt repayment landed: healthy debtors now pay
  // down their oldest obligation each tick.)

  it('settles a mutual debt against itself and marks the smaller one PAID', async () => {
    vi.mocked(prisma.factionDebt.findMany).mockResolvedValueOnce([
      { id: 'aOwesB', creditorFactionId: 'b', debtorFactionId: 'a', amount: 8, turnCreated: 5 },
      { id: 'bOwesA', creditorFactionId: 'a', debtorFactionId: 'b', amount: 3, turnCreated: 5 },
    ] as any)
    mockFactionQueries({
      names: [
        { id: 'b', name: 'Ashcrown' },
        { id: 'a', name: 'Verdant Pact' },
      ], // creditor names for the netting changes; defaulter names
      debtors: [], // the reduced remainder's debtor is unknown here, so it defaults silently
      broke: [],
    })

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
    // The unknown debtor's remainder defaults with no one to penalize:
    // two netting changes, nothing else reported.
    expect(result.changes).toHaveLength(2)
  })

  it('does not default a debt that netting already settled this pass', async () => {
    // Ordering is the whole point: the debtor here is collapsed, so under
    // the old sequence this debt would have defaulted and put a stability
    // shockwave through its creditor. Netting runs first and cancels it
    // against the circle instead, which is the outcome that costs nobody
    // anything.
    vi.mocked(prisma.factionDebt.findMany).mockResolvedValueOnce([
      { id: 'aOwesB', creditorFactionId: 'b', debtorFactionId: 'a', amount: 10, turnCreated: 5 },
      { id: 'bOwesA', creditorFactionId: 'a', debtorFactionId: 'b', amount: 10, turnCreated: 5 },
    ] as any)
    mockFactionQueries({
      names: [
        { id: 'b', name: 'Ashcrown' },
        { id: 'a', name: 'Verdant Pact' },
      ],
      debtors: [],
      broke: [],
    })

    await tickEconomy(baseCtx())

    // Both settled by netting, so nothing reaches the defaulting path.
    expect(prisma.factionDebt.updateMany).not.toHaveBeenCalled()
    expect(prisma.activeWake.create).not.toHaveBeenCalled()
  })

  it('leaves an acyclic debt graph untouched', async () => {
    vi.mocked(prisma.factionDebt.findMany).mockResolvedValueOnce([
      { id: 'd1', creditorFactionId: 'b', debtorFactionId: 'a', amount: 10, turnCreated: 5 },
      { id: 'd2', creditorFactionId: 'c', debtorFactionId: 'b', amount: 4, turnCreated: 5 },
    ] as any)
    mockFactionQueries({
      debtors: [
        { id: 'a', isActive: true, resources: 80, influence: 40 },
        { id: 'b', isActive: true, resources: 80, influence: 40 },
      ],
      resources: [
        { id: 'a', name: 'A', resources: 80 },
        { id: 'b', name: 'B', resources: 80 },
        { id: 'c', name: 'C', resources: 80 },
      ],
      broke: [],
    })

    const result = await tickEconomy(baseCtx())

    // Netting found no cycle, so nothing was written off...
    expect(result.changes.filter((c) => c.reason.includes('written off'))).toEqual([])
    // ...but the healthy debtors still serviced their oldest debt in full.
    expect(result.changes).toHaveLength(6)
    expect(result.changes.filter((c) => c.field === 'debt')).toHaveLength(2)
    expect(result.changes.filter((c) => c.field === 'resources')).toHaveLength(4)
  })

  it('writes no netting in dry-run mode but still reports it', async () => {
    vi.mocked(prisma.factionDebt.findMany).mockResolvedValueOnce([
      { id: 'aOwesB', creditorFactionId: 'b', debtorFactionId: 'a', amount: 6, turnCreated: 5 },
      { id: 'bOwesA', creditorFactionId: 'a', debtorFactionId: 'b', amount: 6, turnCreated: 5 },
    ] as any)
    mockFactionQueries({
      names: [{ id: 'b', name: 'Ashcrown' }, { id: 'a', name: 'Verdant Pact' }],
      broke: [],
    })

    const result = await tickEconomy(baseCtx({ dryRun: true }))

    expect(prisma.factionDebt.update).not.toHaveBeenCalled()
    expect(result.changes).toHaveLength(2)
  })
})
