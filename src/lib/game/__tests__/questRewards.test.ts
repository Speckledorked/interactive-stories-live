// src/lib/game/__tests__/questRewards.test.ts
// Deterministic quest-completion payout (depth-hardening #31).

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mergeGrantedItems, applyQuestRewardGrant } from '../questRewards'

describe('mergeGrantedItems', () => {
  it('adds a brand-new item to an empty inventory', () => {
    const result = mergeGrantedItems(null, [{ id: 'sword-1', name: 'Iron Sword', quantity: 1, tags: ['weapon'] }])
    expect(result.items).toEqual([{ id: 'sword-1', name: 'Iron Sword', quantity: 1, tags: ['weapon'] }])
  })

  it('accumulates quantity when the item id already exists', () => {
    const current = { items: [{ id: 'gold-coin', name: 'Gold Coin', quantity: 5, tags: [] }] }
    const result = mergeGrantedItems(current, [{ id: 'gold-coin', name: 'Gold Coin', quantity: 3, tags: [] }])
    expect(result.items).toEqual([{ id: 'gold-coin', name: 'Gold Coin', quantity: 8, tags: [] }])
  })

  it('preserves existing items untouched when nothing is granted', () => {
    const current = { items: [{ id: 'a', name: 'A', quantity: 1, tags: [] }] }
    const result = mergeGrantedItems(current, undefined)
    expect(result.items).toEqual(current.items)
  })
})

describe('applyQuestRewardGrant', () => {
  const makeDb = () => ({
    character: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    factionStanding: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
    },
    faction: {
      findFirst: vi.fn().mockResolvedValue({ id: 'faction-1', name: 'Merchants Guild', resources: 80 }),
      findUnique: vi.fn().mockResolvedValue({ id: 'faction-1', name: 'Merchants Guild', resources: 80 }),
      update: vi.fn().mockResolvedValue({}),
    },
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('is a no-op with an empty grant', async () => {
    const db = makeDb()
    const log = await applyQuestRewardGrant(db as any, 'camp1', 'The Missing Caravan', {})
    expect(log).toEqual([])
    expect(db.character.findMany).not.toHaveBeenCalled()
  })

  it('grants gold to every living party member when no recipients are named', async () => {
    const db = makeDb()
    db.character.findMany.mockResolvedValue([
      { id: 'c1', name: 'Jason', resources: { gold: 10 }, inventory: null },
      { id: 'c2', name: 'Alia', resources: { gold: 0 }, inventory: null },
    ])
    const log = await applyQuestRewardGrant(db as any, 'camp1', 'The Missing Caravan', { gold: 50 })
    expect(db.character.update).toHaveBeenCalledTimes(2)
    expect(db.character.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { resources: { gold: 60 } } })
    expect(db.character.update).toHaveBeenCalledWith({ where: { id: 'c2' }, data: { resources: { gold: 50 } } })
    expect(log.some(l => l.includes('Jason') && l.includes('50 gold'))).toBe(true)
  })

  it('only grants to named recipients when character_names is set', async () => {
    const db = makeDb()
    // #387: recipients are resolved against the real roster by exact
    // (case-insensitive) name, not by a per-name `contains` query.
    db.character.findMany.mockResolvedValue([
      { id: 'c1', name: 'Jason', resources: { gold: 0 }, inventory: null },
      { id: 'c2', name: 'Mira', resources: { gold: 0 }, inventory: null },
    ])
    const log = await applyQuestRewardGrant(db as any, 'camp1', 'A Personal Favor', {
      character_names: ['jason'],
      gold: 100,
    })
    expect(db.character.update).toHaveBeenCalledTimes(1)
    expect(db.character.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'c1' } }))
    expect(log).toHaveLength(1)
  })

  it('never lets an AI-supplied name act as a SQL wildcard', async () => {
    // #387: `contains` compiles to LIKE '%...%' and Prisma does not escape
    // % or _, so "%" used to match the first living character in the
    // campaign — a payout selector an attacker partially controls.
    const db = makeDb()
    db.character.findMany.mockResolvedValue([
      { id: 'c1', name: 'Jason', resources: { gold: 0 }, inventory: null },
    ])
    const log = await applyQuestRewardGrant(db as any, 'camp1', 'A Personal Favor', {
      character_names: ['%'],
      gold: 100,
    })
    expect(db.character.update).not.toHaveBeenCalled()
    expect(log).toEqual([])
  })

  it('does not pay a near-miss name', async () => {
    // Substring matching is wrong here too: "Bob" must not collect a
    // reward addressed to "Bobby".
    const db = makeDb()
    db.character.findMany.mockResolvedValue([
      { id: 'c1', name: 'Bobby', resources: { gold: 0 }, inventory: null },
    ])
    const log = await applyQuestRewardGrant(db as any, 'camp1', 'A Personal Favor', {
      character_names: ['Bob'],
      gold: 100,
    })
    expect(db.character.update).not.toHaveBeenCalled()
    expect(log).toEqual([])
  })

  it('bounds the total gold one scene may pay out across every entry', async () => {
    // #383: quest_changes is an unbounded array and each completion pays
    // every living member, so a per-entry clamp bounds nothing. The budget
    // is shared by reference across a batch.
    const db = makeDb()
    db.character.findMany.mockResolvedValue([
      { id: 'c1', name: 'Jason', resources: { gold: 0 }, inventory: null },
      { id: 'c2', name: 'Mira', resources: { gold: 0 }, inventory: null },
    ])
    const budget = { remainingGold: 1000 }

    await applyQuestRewardGrant(db as any, 'camp1', 'First', { gold: 400 }, null, null, budget)
    // 400 each x 2 recipients = 800 drawn; 200 left.
    expect(budget.remainingGold).toBe(200)

    const log = await applyQuestRewardGrant(db as any, 'camp1', 'Second', { gold: 400 }, null, null, budget)
    expect(budget.remainingGold).toBe(0)
    expect(log.some((l) => l.includes('payout ceiling'))).toBe(true)

    const third = await applyQuestRewardGrant(db as any, 'camp1', 'Third', { gold: 400 }, null, null, budget)
    expect(third.some((l) => l.includes('maximum'))).toBe(true)
  })

  it('grants items via mergeGrantedItems semantics', async () => {
    const db = makeDb()
    db.character.findMany.mockResolvedValue([
      { id: 'c1', name: 'Jason', resources: {}, inventory: { items: [] } },
    ])
    await applyQuestRewardGrant(db as any, 'camp1', 'The Missing Caravan', {
      items: [{ id: 'ledger', name: 'Merchant Ledger', quantity: 1, tags: [] }],
    })
    expect(db.character.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { inventory: { items: [{ id: 'ledger', name: 'Merchant Ledger', quantity: 1, tags: [] }] } },
    })
  })

  it('applies standing_changes through the same writer standing_changes on pc_changes uses', async () => {
    const db = makeDb()
    db.character.findMany.mockResolvedValue([
      { id: 'c1', name: 'Jason', resources: {}, inventory: null },
    ])
    await applyQuestRewardGrant(db as any, 'camp1', 'The Missing Caravan', {
      standing_changes: [{ faction_name: 'Merchants Guild', delta: 1, reason: 'Delivered the ledger' }],
    })
    expect(db.factionStanding.upsert).toHaveBeenCalled()
  })

  it('clamps an absurd/hallucinated gold amount to the shared magnitude cap', async () => {
    const db = makeDb()
    db.character.findMany.mockResolvedValue([
      { id: 'c1', name: 'Jason', resources: { gold: 0 }, inventory: null },
    ])
    const log = await applyQuestRewardGrant(db as any, 'camp1', 'The Missing Caravan', { gold: 99_999_999 })
    expect(db.character.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { resources: { gold: 100_000 } } })
    expect(log.some(l => l.includes('100000 gold'))).toBe(true)
  })

  it('never grants negative gold, even if the AI reports a negative reward', async () => {
    // A reward is a payout, never a debit. Asserted as the invariant
    // rather than as a specific write, because a zero payout now skips
    // the write entirely instead of re-saving an unchanged value.
    const db = makeDb()
    db.character.findMany.mockResolvedValue([
      { id: 'c1', name: 'Jason', resources: { gold: 10 }, inventory: null },
    ])
    await applyQuestRewardGrant(db as any, 'camp1', 'The Missing Caravan', { gold: -50 })
    for (const call of db.character.update.mock.calls) {
      const gold = (call[0] as any).data?.resources?.gold
      if (gold !== undefined) expect(gold).toBeGreaterThanOrEqual(10)
    }
  })

  it('skips silently when named recipients cannot be resolved', async () => {
    const db = makeDb()
    db.character.findMany.mockResolvedValue([])
    const log = await applyQuestRewardGrant(db as any, 'camp1', 'The Missing Caravan', {
      character_names: ['Nobody'],
      gold: 50,
    })
    expect(log).toEqual([])
    expect(db.character.update).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Faction-funded payouts (the faction-wealth edge of #44/#47/#76/#77)
// ---------------------------------------------------------------------------
// A payout is a TRANSFER: what a faction pays, it stops having. Before
// this, Faction.resources drove ambition thresholds, goal drift and war
// outcomes but never reached a player, and gold appeared from nowhere.

describe('applyQuestRewardGrant — faction-funded payouts', () => {
  const makeDb = () => ({
    character: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([
        { id: 'c1', name: 'Jason', resources: { gold: 0 }, inventory: null },
      ]),
      update: vi.fn().mockResolvedValue({}),
    },
    factionStanding: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn().mockResolvedValue({}) },
    faction: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
    },
  })

  const goldPaid = (db: ReturnType<typeof makeDb>) =>
    (db.character.update.mock.calls[0]?.[0] as any)?.data?.resources?.gold

  it('debits the named paying faction', async () => {
    const db = makeDb()
    db.faction.findFirst.mockResolvedValue({ id: 'f1', name: 'Merchants Guild', resources: 80 })

    await applyQuestRewardGrant(db as any, 'camp1', 'The Ledger Job', {
      gold: 300, paid_by_faction: 'Merchants Guild',
    })

    expect(goldPaid(db)).toBe(300)
    expect(db.faction.update).toHaveBeenCalledWith({
      where: { id: 'f1' },
      data: { resources: 77 }, // 80 - 3 points at 100 gold/point
    })
  })

  it('a broke faction pays what it can and the shortfall is reported', async () => {
    const db = makeDb()
    db.faction.findFirst.mockResolvedValue({ id: 'f1', name: 'Merchants Guild', resources: 2 })

    const log = await applyQuestRewardGrant(db as any, 'camp1', 'The Ledger Job', {
      gold: 1000, paid_by_faction: 'Merchants Guild',
    })

    expect(goldPaid(db)).toBe(200)
    expect(log.some(l => l.includes('could only raise'))).toBe(true)
  })

  it('assesses the cost across the whole party, not per head', async () => {
    // Five people each paid 200 costs the faction a thousand.
    const db = makeDb()
    db.character.findMany.mockResolvedValue(
      ['a', 'b', 'c', 'd', 'e'].map(id => ({ id, name: id, resources: { gold: 0 }, inventory: null }))
    )
    db.faction.findFirst.mockResolvedValue({ id: 'f1', name: 'Merchants Guild', resources: 80 })

    await applyQuestRewardGrant(db as any, 'camp1', 'The Ledger Job', {
      gold: 200, paid_by_faction: 'Merchants Guild',
    })

    expect(db.faction.update).toHaveBeenCalledWith({
      where: { id: 'f1' },
      data: { resources: 70 }, // 1000 gold = 10 points
    })
  })

  it('falls back to the quest giver faction when no payer is named', async () => {
    const db = makeDb()
    db.faction.findUnique.mockResolvedValue({ id: 'giver', name: 'The Ashcrown Court', resources: 60 })

    await applyQuestRewardGrant(db as any, 'camp1', 'The Ledger Job', { gold: 100 }, 'giver')

    expect(db.faction.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'giver' } })
    )
    expect(db.faction.update).toHaveBeenCalled()
  })

  it('pays in full from nowhere when no faction is involved at all', async () => {
    // A private patron. Unchanged from before this feature existed.
    const db = makeDb()
    await applyQuestRewardGrant(db as any, 'camp1', 'The Ledger Job', { gold: 250 })
    expect(goldPaid(db)).toBe(250)
    expect(db.faction.update).not.toHaveBeenCalled()
  })

  it('pays in full rather than withholding when the named faction does not resolve', async () => {
    // Failing to charge someone is a far cheaper error than failing to pay
    // the party what the fiction promised them.
    const db = makeDb()
    db.faction.findFirst.mockResolvedValue(null)
    await applyQuestRewardGrant(db as any, 'camp1', 'The Ledger Job', {
      gold: 250, paid_by_faction: 'A Guild That Does Not Exist',
    })
    expect(goldPaid(db)).toBe(250)
    expect(db.faction.update).not.toHaveBeenCalled()
  })

  it('does not touch a payer for an items-only reward', async () => {
    const db = makeDb()
    db.faction.findFirst.mockResolvedValue({ id: 'f1', name: 'Merchants Guild', resources: 80 })
    await applyQuestRewardGrant(db as any, 'camp1', 'The Ledger Job', {
      items: [{ id: 'i1', name: 'Signet Ring', quantity: 1 }],
      paid_by_faction: 'Merchants Guild',
    })
    expect(db.faction.update).not.toHaveBeenCalled()
  })
})
