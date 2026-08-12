// src/lib/downtime/__tests__/downtimeRewards.test.ts
//
// Downtime payouts (#74). The engine charged entry costs for real and then
// applied none of the rewards it narrated — these cover both the strict
// parsing of the AI's loose payload and the application itself.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/game/standing', () => ({
  applyStandingChanges: vi.fn(async () => {}),
}))

import { applyStandingChanges } from '@/lib/game/standing'
import { parseDowntimeRewards, parseReputationLine, applyDowntimeRewards } from '../downtimeRewards'

describe('parseReputationLine', () => {
  it('parses the documented "Faction: +N" shape', () => {
    expect(parseReputationLine('Thieves Guild: +2')).toMatchObject({ faction_name: 'Thieves Guild', delta: 2 })
  })

  it('parses a negative delta', () => {
    expect(parseReputationLine('City Watch: -1')).toMatchObject({ faction_name: 'City Watch', delta: -1 })
  })

  it('parses a bare number with no sign', () => {
    expect(parseReputationLine('Merchants: 3')).toMatchObject({ faction_name: 'Merchants', delta: 3 })
  })

  it('splits on the LAST colon so a faction name containing one still works', () => {
    expect(parseReputationLine('The Order: Ascendant: +2')).toMatchObject({
      faction_name: 'The Order: Ascendant',
      delta: 2,
    })
  })

  it('rejects rather than guesses when the delta has stray text', () => {
    // parseInt would happily read "2 or maybe 3" as 2. Inventing a number
    // from an ambiguous string is exactly what this engine avoids.
    expect(parseReputationLine('Guild: 2 or maybe 3')).toBeNull()
    expect(parseReputationLine('Guild: a lot')).toBeNull()
  })

  it('rejects a zero delta as a no-op', () => {
    expect(parseReputationLine('Guild: 0')).toBeNull()
  })

  it('rejects lines with no colon or no faction name', () => {
    expect(parseReputationLine('Guild +2')).toBeNull()
    expect(parseReputationLine(': +2')).toBeNull()
  })
})

describe('parseDowntimeRewards', () => {
  it('returns an empty result for junk input', () => {
    for (const junk of [null, undefined, 'a string', 42]) {
      const result = parseDowntimeRewards(junk)
      expect(result).toMatchObject({ gold: 0, items: [], standingChanges: [], contacts: [] })
    }
  })

  it('parses a full, well-formed payload', () => {
    const result = parseDowntimeRewards({
      materialRewards: { goldGained: 300, itemsCreated: ['Silvered Dagger', 'Healing Draught'] },
      relationships: { contactsGained: ['Old Maren'], reputationChanges: ['Thieves Guild: +2'] },
    })
    expect(result.gold).toBe(300)
    expect(result.items).toHaveLength(2)
    expect(result.items[0]).toMatchObject({ name: 'Silvered Dagger', quantity: 1, itemType: 'misc' })
    expect(result.contacts).toEqual(['Old Maren'])
    expect(result.standingChanges).toHaveLength(1)
    expect(result.skipped).toEqual([])
  })

  it('floors negative gold at zero — a payout is never a debit', () => {
    const result = parseDowntimeRewards({ materialRewards: { goldGained: -500 } })
    expect(result.gold).toBe(0)
  })

  it('clamps an absurd gold value rather than applying it', () => {
    const result = parseDowntimeRewards({ materialRewards: { goldGained: 999_999_999 } })
    expect(result.gold).toBeLessThanOrEqual(100_000)
  })

  it('never infers mechanically-live item fields from a name string', () => {
    // Guessing armorValue/damageBonus from "Plate Armor" would be the
    // keyword-heuristic pattern this codebase rejects.
    const result = parseDowntimeRewards({
      materialRewards: { itemsCreated: ['Plate Armor', 'Greatsword', 'Potion of Healing'] },
    })
    for (const item of result.items) {
      expect(item.armorValue).toBeUndefined()
      expect(item.damageBonus).toBeUndefined()
      expect(item.effect).toBeUndefined()
    }
  })

  it('skips unparseable entries instead of guessing, and records them', () => {
    const result = parseDowntimeRewards({
      materialRewards: { itemsCreated: ['Good Sword', '', null, 42] },
      relationships: { reputationChanges: ['Guild: +1', 'nonsense line', { not: 'a string' }] },
    })
    expect(result.items).toHaveLength(1)
    expect(result.standingChanges).toHaveLength(1)
    expect(result.skipped.length).toBeGreaterThanOrEqual(4)
  })

  it('tolerates partial payloads with missing sections', () => {
    const result = parseDowntimeRewards({ materialRewards: { goldGained: 50 } })
    expect(result.gold).toBe(50)
    expect(result.standingChanges).toEqual([])
    expect(result.contacts).toEqual([])
  })
})

describe('applyDowntimeRewards', () => {
  const makeDb = (character: any = { id: 'ch1', name: 'Vera', resources: { gold: 10 }, inventory: null, isAlive: true }) => ({
    character: {
      findUnique: vi.fn(async () => character),
      update: vi.fn(async () => ({})),
    },
  })

  beforeEach(() => vi.clearAllMocks())

  const empty = { gold: 0, items: [], standingChanges: [], contacts: [], skipped: [] }

  it('is a complete no-op when there is nothing to grant', async () => {
    const db = makeDb()
    const log = await applyDowntimeRewards(db as any, 'camp1', 'ch1', 'Rest', empty)
    expect(log).toEqual([])
    expect(db.character.findUnique).not.toHaveBeenCalled()
    expect(db.character.update).not.toHaveBeenCalled()
  })

  it('adds gold on top of the existing balance', async () => {
    const db = makeDb()
    await applyDowntimeRewards(db as any, 'camp1', 'ch1', 'Smithing', { ...empty, gold: 300 })
    const data = (db.character.update.mock.calls as any[])[0][0].data
    expect(data.resources.gold).toBe(310)
  })

  it('merges contacts without duplicating existing ones', async () => {
    const db = makeDb({ id: 'ch1', name: 'Vera', resources: { gold: 0, contacts: ['Old Maren'] }, inventory: null })
    await applyDowntimeRewards(db as any, 'camp1', 'ch1', 'Carousing', {
      ...empty,
      contacts: ['Old Maren', 'Fence Ilya'],
    })
    const data = (db.character.update.mock.calls as any[])[0][0].data
    expect(data.resources.contacts).toEqual(['Old Maren', 'Fence Ilya'])
  })

  it('routes standing through the shared writer rather than reimplementing bounds', async () => {
    const db = makeDb()
    const standingChanges = [{ faction_name: 'Guild', delta: 2, reason: 'Downtime activity' }]
    await applyDowntimeRewards(db as any, 'camp1', 'ch1', 'Favors', { ...empty, standingChanges })
    expect(applyStandingChanges).toHaveBeenCalledWith(
      db, 'camp1', 'ch1', 'Vera', standingChanges, expect.any(Array)
    )
  })

  it('targets the character by id, never by fuzzy name match', async () => {
    const db = makeDb()
    await applyDowntimeRewards(db as any, 'camp1', 'ch1', 'Smithing', { ...empty, gold: 5 })
    expect(db.character.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'ch1' } })
    )
  })

  it('skips cleanly when the character no longer exists', async () => {
    const db = makeDb(null)
    const log = await applyDowntimeRewards(db as any, 'camp1', 'gone', 'Smithing', { ...empty, gold: 100 })
    expect(log).toEqual([])
    expect(db.character.update).not.toHaveBeenCalled()
  })

  it('reports what was granted in the returned log', async () => {
    const db = makeDb()
    const log = await applyDowntimeRewards(db as any, 'camp1', 'ch1', 'Smithing', {
      ...empty,
      gold: 300,
      items: [{ id: 'dagger', name: 'Silvered Dagger', quantity: 1 }],
    })
    expect(log.join(' ')).toContain('300 gold')
    expect(log.join(' ')).toContain('Silvered Dagger')
  })

  // #211: downtime rewards used to call mergeGrantedItems directly, never
  // through applyGrantBudget — the per-arc rarity cap quest rewards
  // already enforce. A player could stack unlimited concurrent trivial
  // downtime activities, each granting unbudgeted items.
  it('skips an item grant that would exceed the per-arc rarity budget when currentTurn is provided', async () => {
    // A legendary item already spends the entire 8-point arc budget on its
    // own (see MAX_RARITY_POINTS_PER_ARC/rarityPoints in itemValue.ts).
    const db = makeDb({
      id: 'ch1', name: 'Vera', resources: { gold: 0 },
      inventory: { items: [{ id: 'old-sword', name: 'Old Sword', quantity: 1, rarity: 'legendary', grantedTurn: 5 }] },
      isAlive: true,
    })
    const log = await applyDowntimeRewards(db as any, 'camp1', 'ch1', 'Smithing', {
      ...empty,
      items: [{ id: 'new-trinket', name: 'New Trinket', quantity: 1, rarity: 'common' }],
    }, 5)

    expect(log.join(' ')).toContain('beyond what Vera has earned this arc')
    expect(db.character.update).not.toHaveBeenCalled()
  })

  it('grants an item that fits within the per-arc rarity budget when currentTurn is provided', async () => {
    const db = makeDb({
      id: 'ch1', name: 'Vera', resources: { gold: 0 }, inventory: { items: [] }, isAlive: true,
    })
    const log = await applyDowntimeRewards(db as any, 'camp1', 'ch1', 'Smithing', {
      ...empty,
      items: [{ id: 'new-trinket', name: 'New Trinket', quantity: 1, rarity: 'common' }],
    }, 5)

    expect(log.join(' ')).toContain('New Trinket')
    const data = (db.character.update.mock.calls as any[])[0][0].data
    expect(data.inventory.items.some((i: any) => i.id === 'new-trinket')).toBe(true)
    // The stored item is stamped with the turn it was actually granted,
    // matching questRewards.ts's own convention.
    expect(data.inventory.items.find((i: any) => i.id === 'new-trinket').grantedTurn).toBe(5)
  })

  it('grants items with no budget check at all when currentTurn is omitted (backward-compatible fallback)', async () => {
    const db = makeDb({
      id: 'ch1', name: 'Vera', resources: { gold: 0 },
      inventory: { items: [{ id: 'old-sword', name: 'Old Sword', quantity: 1, rarity: 'legendary', grantedTurn: 5 }] },
      isAlive: true,
    })
    const log = await applyDowntimeRewards(db as any, 'camp1', 'ch1', 'Smithing', {
      ...empty,
      items: [{ id: 'new-trinket', name: 'New Trinket', quantity: 1, rarity: 'common' }],
    })

    expect(log.join(' ')).toContain('New Trinket')
    const data = (db.character.update.mock.calls as any[])[0][0].data
    expect(data.inventory.items.some((i: any) => i.id === 'new-trinket')).toBe(true)
  })
})
