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
      findFirst: vi.fn().mockResolvedValue({ id: 'faction-1', name: 'Merchants Guild' }),
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
    db.character.findFirst.mockResolvedValue({ id: 'c1', name: 'Jason', resources: { gold: 0 }, inventory: null })
    const log = await applyQuestRewardGrant(db as any, 'camp1', 'A Personal Favor', {
      character_names: ['Jason'],
      gold: 100,
    })
    expect(db.character.findMany).not.toHaveBeenCalled()
    expect(db.character.update).toHaveBeenCalledTimes(1)
    expect(log).toHaveLength(1)
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
    const db = makeDb()
    db.character.findMany.mockResolvedValue([
      { id: 'c1', name: 'Jason', resources: { gold: 10 }, inventory: null },
    ])
    await applyQuestRewardGrant(db as any, 'camp1', 'The Missing Caravan', { gold: -50 })
    expect(db.character.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { resources: { gold: 10 } } })
  })

  it('skips silently when named recipients cannot be resolved', async () => {
    const db = makeDb()
    db.character.findFirst.mockResolvedValue(null)
    const log = await applyQuestRewardGrant(db as any, 'camp1', 'The Missing Caravan', {
      character_names: ['Nobody'],
      gold: 50,
    })
    expect(log).toEqual([])
    expect(db.character.update).not.toHaveBeenCalled()
  })
})
