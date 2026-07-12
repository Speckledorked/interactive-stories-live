// src/lib/game/__tests__/debts.test.ts
// Urban Shadows Debt economy: the writer's incur/resolve semantics and
// the diegetic read-side shaping.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { applyDebtChanges, summarizeDebts, formatDebtsForPrompt, DebtChange } from '../debts'

const makeDb = () => ({
  faction: { findFirst: vi.fn().mockResolvedValue(null) },
  nPC: { findFirst: vi.fn().mockResolvedValue(null) },
  debt: {
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn(async ({ data }: any) => data),
    update: vi.fn(async () => ({})),
  },
})

let db: ReturnType<typeof makeDb>
beforeEach(() => {
  db = makeDb()
})

const incur: DebtChange = {
  counterparty_name: 'Lord Kessler',
  counterparty_type: 'npc',
  direction: 'owed_by_character',
  action: 'incur',
  description: 'Smuggled the party out of the burning district',
  reason: 'A real favor',
}

describe('applyDebtChanges — incur', () => {
  it('creates an outstanding debt and resolves a known counterparty id', async () => {
    db.nPC.findFirst.mockResolvedValue({ id: 'npc9' })

    const log = await applyDebtChanges(db as any, 'camp1', 'char1', 'Jason', [incur], 12)

    expect(db.debt.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          direction: 'OWED_BY_CHARACTER',
          counterpartyId: 'npc9',
          counterpartyName: 'Lord Kessler',
          turnCreated: 12,
        }),
      })
    )
    expect(log).toEqual(['Jason now owes Lord Kessler: Smuggled the party out of the burning district'])
  })

  it('still creates the debt when the counterparty is unknown (id null)', async () => {
    await applyDebtChanges(db as any, 'camp1', 'char1', 'Jason', [incur], 12)
    expect(db.debt.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ counterpartyId: null }) })
    )
  })

  it('does not stack an identical open debt', async () => {
    db.debt.findFirst.mockResolvedValue({ id: 'existing' })
    const log = await applyDebtChanges(db as any, 'camp1', 'char1', 'Jason', [incur], 12)
    expect(db.debt.create).not.toHaveBeenCalled()
    expect(log).toEqual([])
  })

  it('skips changes missing name or description', async () => {
    await applyDebtChanges(db as any, 'camp1', 'char1', 'Jason', [
      { ...incur, counterparty_name: '  ' },
      { ...incur, description: '' },
    ], 12)
    expect(db.debt.create).not.toHaveBeenCalled()
  })
})

describe('applyDebtChanges — resolve', () => {
  const resolve: DebtChange = {
    counterparty_name: 'Lord Kessler',
    counterparty_type: 'npc',
    direction: 'owed_by_character',
    action: 'resolve',
    description: 'Repaid by guarding his caravan',
    reason: 'Debt honored',
  }

  it('resolves the oldest matching open debt', async () => {
    db.debt.findFirst.mockResolvedValue({ id: 'debt1' })

    const log = await applyDebtChanges(db as any, 'camp1', 'char1', 'Jason', [resolve], 20)

    expect(db.debt.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'OUTSTANDING', direction: 'OWED_BY_CHARACTER' }),
        orderBy: { createdAt: 'asc' },
      })
    )
    expect(db.debt.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'debt1' },
        data: expect.objectContaining({ status: 'RESOLVED', resolution: 'Repaid by guarding his caravan', turnResolved: 20 }),
      })
    )
    expect(log).toEqual(['Debt settled with Lord Kessler: Repaid by guarding his caravan'])
  })

  it('skips silently when no open debt matches', async () => {
    const log = await applyDebtChanges(db as any, 'camp1', 'char1', 'Jason', [resolve], 20)
    expect(db.debt.update).not.toHaveBeenCalled()
    expect(log).toEqual([])
  })
})

describe('read-side shaping', () => {
  const rows = [
    { direction: 'OWED_BY_CHARACTER' as const, counterpartyName: 'Thieves Guild', description: 'They hid him from the watch' },
    { direction: 'OWED_TO_CHARACTER' as const, counterpartyName: 'Mira', description: 'He saved her brother' },
  ]

  it('splits directions', () => {
    const summary = summarizeDebts(rows)
    expect(summary.owedByCharacter).toEqual([{ counterparty: 'Thieves Guild', description: 'They hid him from the watch' }])
    expect(summary.owedToCharacter).toEqual([{ counterparty: 'Mira', description: 'He saved her brother' }])
  })

  it('formats diegetic prompt lines', () => {
    const lines = formatDebtsForPrompt(summarizeDebts(rows), 'Jason')
    expect(lines).toEqual([
      'Jason owes Thieves Guild (They hid him from the watch)',
      'Mira owes Jason (He saved her brother)',
    ])
  })
})
