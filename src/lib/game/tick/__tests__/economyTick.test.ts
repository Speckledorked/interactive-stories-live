import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    factionDebt: { findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
    faction: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    activeWake: { create: vi.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import { decideLoanExtension, decideDefaultCascade, tickEconomy } from '../economyTick'
import type { TickContext } from '../types'

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
    expect(result.changes[0]).toMatchObject({ entityType: 'FACTION', entityId: 'creditor1', field: 'stability', origin: 'wake' })
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
        { id: 'broke1', name: 'Struggling Co', resources: 10, relationships: { ally1: { type: 'ALLY', since: 1 } } },
      ] as any) // broke factions
      .mockResolvedValueOnce([{ id: 'ally1', name: 'Wealthy Co', resources: 90 }] as any) // allies lookup
    vi.mocked(prisma.factionDebt.findFirst).mockResolvedValueOnce(null) // no existing debt

    const result = await tickEconomy(baseCtx())

    expect(prisma.factionDebt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ creditorFactionId: 'ally1', debtorFactionId: 'broke1', amount: 15, turnCreated: 10 }),
    })
    expect(prisma.faction.update).toHaveBeenCalledWith({ where: { id: 'ally1' }, data: { resources: 75 } })
    expect(prisma.faction.update).toHaveBeenCalledWith({ where: { id: 'broke1' }, data: { resources: 25 } })
    expect(result.changes).toHaveLength(1)
    expect(result.changes[0]).toMatchObject({ entityId: 'broke1', field: 'resources' })
  })

  it('#238: swallows a P2002 from the DB-level single-outstanding-debt backstop instead of aborting the whole tick', async () => {
    // The rare window this backstops: the findFirst check above (mocked
    // null here, "no existing debt") and the create below it are two
    // separate statements — the new partial unique index (see the
    // migration) is what actually enforces the invariant if they ever
    // race. An uncaught P2002 here would abort runWorldTick's entire
    // transaction, not just this one loan, so this must be caught.
    const { Prisma } = await import('@prisma/client')
    vi.mocked(prisma.factionDebt.findMany).mockResolvedValueOnce([])
    vi.mocked(prisma.faction.findMany)
      .mockResolvedValueOnce([
        { id: 'broke1', name: 'Struggling Co', resources: 10, relationships: { ally1: { type: 'ALLY', since: 1 } } },
      ] as any)
      .mockResolvedValueOnce([{ id: 'ally1', name: 'Wealthy Co', resources: 90 }] as any)
    vi.mocked(prisma.factionDebt.findFirst).mockResolvedValueOnce(null)
    vi.mocked(prisma.factionDebt.create).mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'x' })
    )

    const result = await tickEconomy(baseCtx())

    expect(prisma.faction.update).not.toHaveBeenCalled()
    expect(result.changes).toEqual([])
  })

  it('re-throws a non-constraint error from the FactionDebt create rather than silently swallowing it', async () => {
    vi.mocked(prisma.factionDebt.findMany).mockResolvedValueOnce([])
    vi.mocked(prisma.faction.findMany)
      .mockResolvedValueOnce([
        { id: 'broke1', name: 'Struggling Co', resources: 10, relationships: { ally1: { type: 'ALLY', since: 1 } } },
      ] as any)
      .mockResolvedValueOnce([{ id: 'ally1', name: 'Wealthy Co', resources: 90 }] as any)
    vi.mocked(prisma.factionDebt.findFirst).mockResolvedValueOnce(null)
    vi.mocked(prisma.factionDebt.create).mockRejectedValueOnce(new Error('connection reset'))

    await expect(tickEconomy(baseCtx())).rejects.toThrow('connection reset')
  })

  it('does not originate a second loan while one is already outstanding', async () => {
    vi.mocked(prisma.factionDebt.findMany).mockResolvedValueOnce([])
    vi.mocked(prisma.faction.findMany).mockResolvedValueOnce([
      { id: 'broke1', name: 'Struggling Co', resources: 10, relationships: { ally1: { type: 'ALLY', since: 1 } } },
    ] as any)
    vi.mocked(prisma.factionDebt.findFirst).mockResolvedValueOnce({ id: 'existing-debt' } as any)

    const result = await tickEconomy(baseCtx())

    expect(prisma.factionDebt.create).not.toHaveBeenCalled()
    expect(result.changes).toEqual([])
  })

  it('does not originate a loan when the broke faction has no ally at all', async () => {
    vi.mocked(prisma.factionDebt.findMany).mockResolvedValueOnce([])
    vi.mocked(prisma.faction.findMany).mockResolvedValueOnce([
      { id: 'broke1', name: 'Struggling Co', resources: 10, relationships: {} },
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
        { id: 'broke1', name: 'Struggling Co', resources: 10, relationships: { ally1: { type: 'ALLY', since: 1 } } },
      ] as any)
      .mockResolvedValueOnce([{ id: 'ally1', name: 'Wealthy Co', resources: 90 }] as any)
    vi.mocked(prisma.factionDebt.findFirst).mockResolvedValueOnce(null)

    const result = await tickEconomy(baseCtx({ dryRun: true }))

    expect(prisma.factionDebt.create).not.toHaveBeenCalled()
    expect(prisma.faction.update).not.toHaveBeenCalled()
    expect(result.changes).toHaveLength(1)
  })
})
