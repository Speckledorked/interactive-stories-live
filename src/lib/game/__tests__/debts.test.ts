// src/lib/game/__tests__/debts.test.ts
// Urban Shadows Debt economy: the writer's incur/resolve semantics and
// the diegetic read-side shaping.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { applyDebtChanges, summarizeDebts, formatDebtsForPrompt, debtChangeFromConsequence, debtModifier, debtsWithCounterparty, DebtChange } from '../debts'

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

describe('debtChangeFromConsequence (#69)', () => {
  it('ignores every consequence type that is not a debt', () => {
    for (const type of ['promise', 'enemy', 'longTermThreat']) {
      expect(debtChangeFromConsequence({ type, description: 'x', counterparty_name: 'Vashti' })).toBeNull()
    }
  })

  it('turns a debt consequence into an incur against the named counterparty', () => {
    expect(debtChangeFromConsequence({
      type: 'debt',
      description: 'She got them out of the district',
      counterparty_name: 'Vashti',
      counterparty_type: 'npc',
      direction: 'owed_to_character',
    })).toEqual({
      counterparty_name: 'Vashti',
      counterparty_type: 'npc',
      direction: 'owed_to_character',
      action: 'incur',
      description: 'She got them out of the district',
      reason: expect.any(String),
    })
  })

  it('defaults to a debt the party owes, and to an NPC counterparty', () => {
    // A bare "this became a debt" means the party owes someone. Guessing
    // the other way would hand players leverage they never earned.
    const debt = debtChangeFromConsequence({ type: 'debt', description: 'x', counterparty_name: 'Vashti' })!
    expect(debt.direction).toBe('owed_by_character')
    expect(debt.counterparty_type).toBe('npc')
  })

  it('never produces a debt owed to nobody', () => {
    // Such a row could never be called in, which is the whole point of the
    // Debt model. Dropping beats writing something inert.
    expect(debtChangeFromConsequence({ type: 'debt', description: 'Owes someone' })).toBeNull()
    expect(debtChangeFromConsequence({ type: 'debt', description: 'Owes someone', counterparty_name: '   ' })).toBeNull()
  })

  it('never produces a debt with no fiction behind it', () => {
    expect(debtChangeFromConsequence({ type: 'debt', description: '', counterparty_name: 'Vashti' })).toBeNull()
    expect(debtChangeFromConsequence({ type: 'debt', counterparty_name: 'Vashti' })).toBeNull()
  })

  it('trims the counterparty so the writer name-matches cleanly', () => {
    // applyDebtChanges resolves counterparties by case-insensitive name;
    // stray whitespace would silently miss a real NPC.
    const debt = debtChangeFromConsequence({ type: 'debt', description: 'x', counterparty_name: '  Vashti  ' })!
    expect(debt.counterparty_name).toBe('Vashti')
  })

  it('produces something applyDebtChanges actually accepts', async () => {
    // The conversion is only useful if the writer takes it end to end.
    const db = makeDb()
    const debt = debtChangeFromConsequence({
      type: 'debt', description: 'Smuggled them out', counterparty_name: 'Vashti', counterparty_type: 'npc',
    })!
    const log = await applyDebtChanges(db as any, 'camp1', 'char1', 'Jason', [debt], 4)
    expect(db.debt.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          counterpartyName: 'Vashti',
          direction: 'OWED_BY_CHARACTER',
          description: 'Smuggled them out',
          turnCreated: 4,
        }),
      })
    )
    expect(log).toEqual(['Jason now owes Vashti: Smuggled them out'])
  })
})

// ---------------------------------------------------------------------------
// Roll-time weight (the Debt half of the economy question, #44/#47)
// ---------------------------------------------------------------------------
// Debt was the one Urban Shadows currency with no mechanical weight:
// standing, relationships and corruption all move a roll, while "the
// social currency of this world" reached the prompt as prose and bought
// nothing.

describe('debtModifier', () => {
  it('helps when they owe you', () => {
    expect(debtModifier({ counterpartyName: 'Kessler', owedToCharacter: 1, owedByCharacter: 0 })).toBe(1)
  })

  it('hurts when you owe them', () => {
    // "You already owe me" is a real answer to a request.
    expect(debtModifier({ counterpartyName: 'Kessler', owedToCharacter: 0, owedByCharacter: 1 })).toBe(-1)
  })

  it('nets debts in both directions to a wash', () => {
    // Two people square with each other is not two independent pressures.
    expect(debtModifier({ counterpartyName: 'Kessler', owedToCharacter: 2, owedByCharacter: 2 })).toBe(0)
  })

  it('flattens past the second favor', () => {
    // A pile of small favors must not out-weigh a deep faction standing,
    // and without the flattening a narrator who likes recording debts
    // would quietly inflate the scale.
    expect(debtModifier({ counterpartyName: 'K', owedToCharacter: 2, owedByCharacter: 0 })).toBe(2)
    expect(debtModifier({ counterpartyName: 'K', owedToCharacter: 9, owedByCharacter: 0 })).toBe(2)
    expect(debtModifier({ counterpartyName: 'K', owedToCharacter: 0, owedByCharacter: 9 })).toBe(-2)
  })

  it('stays within the same scale as standing and relationships', () => {
    for (const owedTo of [0, 1, 5, 50]) {
      for (const owedBy of [0, 1, 5, 50]) {
        const mod = debtModifier({ counterpartyName: 'K', owedToCharacter: owedTo, owedByCharacter: owedBy })
        expect(mod).toBeGreaterThanOrEqual(-2)
        expect(mod).toBeLessThanOrEqual(2)
      }
    }
  })

  it('is zero with no ledger at all', () => {
    expect(debtModifier(null)).toBe(0)
    expect(debtModifier(undefined)).toBe(0)
  })

  it('treats malformed counts as none', () => {
    expect(debtModifier({ counterpartyName: 'K', owedToCharacter: NaN, owedByCharacter: -3 } as any)).toBe(0)
  })
})

describe('debtsWithCounterparty', () => {
  const rows = [
    { direction: 'OWED_TO_CHARACTER' as const, counterpartyName: 'Lord Kessler', counterpartyId: 'npc1' },
    { direction: 'OWED_BY_CHARACTER' as const, counterpartyName: 'Thieves Guild', counterpartyId: 'f1' },
    { direction: 'OWED_BY_CHARACTER' as const, counterpartyName: 'Lord Kessler', counterpartyId: null },
  ]

  it('collects both directions for one counterparty', () => {
    expect(debtsWithCounterparty(rows, { id: 'npc1', name: 'Lord Kessler' })).toEqual({
      counterpartyName: 'Lord Kessler',
      owedToCharacter: 1,
      owedByCharacter: 1,
    })
  })

  it('matches on name when the debt was incurred before the entity resolved', () => {
    // counterpartyId is only set when the name matched a known entity at
    // the time — the same id-then-name fallback weather already uses.
    expect(debtsWithCounterparty(
      [{ direction: 'OWED_TO_CHARACTER', counterpartyName: 'lord kessler', counterpartyId: null }],
      { id: 'npc1', name: 'Lord Kessler' }
    )?.owedToCharacter).toBe(1)
  })

  it('returns nothing when there is no ledger with this counterparty', () => {
    expect(debtsWithCounterparty(rows, { id: 'npc9', name: 'A Stranger' })).toBeNull()
    expect(debtsWithCounterparty([], { id: 'npc1', name: 'Lord Kessler' })).toBeNull()
  })

  it('never bleeds one counterparty ledger into another', () => {
    const guild = debtsWithCounterparty(rows, { id: 'f1', name: 'Thieves Guild' })
    expect(guild).toEqual({ counterpartyName: 'Thieves Guild', owedToCharacter: 0, owedByCharacter: 1 })
  })
})
