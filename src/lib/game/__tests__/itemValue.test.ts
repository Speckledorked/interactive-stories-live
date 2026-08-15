// src/lib/game/__tests__/itemValue.test.ts
//
// Item value and rarity (#44/#47). These fields would be decorative
// without the two things tested hardest here: the per-arc rarity budget
// that stops an economy being inflated a scene at a time, and the
// derivation of that budget from the inventory itself rather than from a
// counter that can drift.

import { describe, it, expect } from 'vitest'
import {
  RARITY_ORDER,
  rarityRank,
  isItemRarity,
  itemUnitValue,
  itemStackValue,
  inventoryValue,
  describeWealth,
  rarityPoints,
  rarityPointsInArc,
  applyGrantBudget,
  DEFAULT_VALUE_BY_RARITY,
  MAX_ITEM_VALUE,
  MAX_RARITY_POINTS_PER_ARC,
  ARC_LENGTH_TURNS,
  maxValueForRarity,
} from '../itemValue'

describe('rarity', () => {
  it('ranks the ladder in order', () => {
    expect(RARITY_ORDER.map(rarityRank)).toEqual([0, 1, 2, 3])
  })

  it('treats anything unrecognized as common rather than throwing', () => {
    // These come off an AI response and out of a JSON column.
    expect(rarityRank(undefined)).toBe(0)
    expect(rarityRank('mythic')).toBe(0)
    expect(rarityRank(7)).toBe(0)
    expect(isItemRarity('mythic')).toBe(false)
  })
})

describe('itemUnitValue', () => {
  it('prefers a reported value within what the rarity can plausibly be worth', () => {
    expect(itemUnitValue({ value: 30, rarity: 'common' })).toBe(30)
  })

  it('falls back to what the rarity implies, so rarity is never free', () => {
    // An AI that says "legendary" without a number has still said
    // something expensive, and the budget and payout cost both need one.
    expect(itemUnitValue({ rarity: 'legendary' })).toBe(DEFAULT_VALUE_BY_RARITY.legendary)
    expect(itemUnitValue({ rarity: 'uncommon' })).toBe(DEFAULT_VALUE_BY_RARITY.uncommon)
  })

  it('is zero for an item with neither', () => {
    expect(itemUnitValue({ name: 'a length of rope' })).toBe(0)
    expect(itemUnitValue(null)).toBe(0)
  })

  it('never treats an item as a liability', () => {
    expect(itemUnitValue({ value: -500 })).toBe(0)
  })

  it('clamps a pathological reported value to its own rarity tier\'s ceiling, not the absolute max', () => {
    expect(itemUnitValue({ value: 1e12, rarity: 'common' })).toBe(maxValueForRarity('common'))
    expect(itemUnitValue({ value: 1e12, rarity: 'common' })).toBeLessThan(MAX_ITEM_VALUE)
    expect(itemUnitValue({ value: NaN })).toBe(0)
  })

  // #277 (adversarial audit, Finding #7): rarity and value are
  // independently AI-controlled — applyGrantBudget spends against rarity
  // alone, so an under-reported rarity paired with an inflated value used
  // to sail through the budget almost for free while still contributing
  // its full inflated value to inventoryValue()/payout cost.
  it('#277: clamps a mismatched rarity/value pair instead of trusting value independently', () => {
    const exploitAttempt = itemUnitValue({ rarity: 'common', value: 1_000_000 })
    expect(exploitAttempt).toBe(maxValueForRarity('common'))
    expect(exploitAttempt).toBeLessThan(1_000_000)
  })

  it('#277: missing rarity clamps to the same cheapest tier rarityRank falls back to, not an unbounded value', () => {
    // Omitting rarity entirely costs the grant budget the same as
    // 'common' (rarityRank's own fallback) — the value ceiling must match
    // that fallback too, or omission becomes a second bypass route.
    expect(itemUnitValue({ value: 1_000_000 })).toBe(maxValueForRarity('common'))
  })

  it('#277: still allows real headroom above the rarity default, not just the default itself', () => {
    expect(maxValueForRarity('common')).toBeGreaterThan(DEFAULT_VALUE_BY_RARITY.common)
    expect(itemUnitValue({ rarity: 'uncommon', value: DEFAULT_VALUE_BY_RARITY.uncommon * 2 })).toBe(
      DEFAULT_VALUE_BY_RARITY.uncommon * 2
    )
  })

  it('#277: a legendary item genuinely can be worth far more than a common one', () => {
    expect(maxValueForRarity('legendary')).toBeGreaterThan(maxValueForRarity('common'))
    expect(itemUnitValue({ rarity: 'legendary', value: 40_000 })).toBe(40_000)
  })
})

describe('itemStackValue / inventoryValue', () => {
  it('multiplies by quantity', () => {
    expect(itemStackValue({ value: 10, quantity: 5 })).toBe(50)
  })

  it('treats a missing or malformed quantity as one', () => {
    expect(itemStackValue({ value: 10 })).toBe(10)
    expect(itemStackValue({ value: 10, quantity: 0 })).toBe(10)
    expect(itemStackValue({ value: 10, quantity: NaN })).toBe(10)
  })

  it('totals a whole inventory', () => {
    expect(inventoryValue([
      { value: 100, quantity: 2, rarity: 'uncommon' },
      { rarity: 'rare' },
      { name: 'rope' },
    ])).toBe(200 + DEFAULT_VALUE_BY_RARITY.rare)
  })

  it('is zero for a missing or malformed inventory', () => {
    expect(inventoryValue(null)).toBe(0)
    expect(inventoryValue(undefined)).toBe(0)
    expect(inventoryValue('nope' as any)).toBe(0)
  })
})

describe('describeWealth', () => {
  it('bands without ever naming a number', () => {
    for (const total of [0, 100, 500, 5000, 50000]) {
      expect(describeWealth(total)).not.toMatch(/\d/)
    }
  })

  it('rises monotonically with wealth', () => {
    const bands = [0, 100, 500, 5000, 50000].map(describeWealth)
    expect(new Set(bands).size).toBe(bands.length)
  })
})

describe('rarityPoints', () => {
  it('doubles per rank, so a legendary costs the whole arc', () => {
    expect(rarityPoints('common')).toBe(1)
    expect(rarityPoints('uncommon')).toBe(2)
    expect(rarityPoints('rare')).toBe(4)
    expect(rarityPoints('legendary')).toBe(MAX_RARITY_POINTS_PER_ARC)
  })
})

describe('rarityPointsInArc', () => {
  it('counts only what was granted inside the window', () => {
    const items = [
      { rarity: 'rare', grantedTurn: 8 },   // 2 turns ago — in window
      { rarity: 'rare', grantedTurn: 0 },   // 10 turns ago — aged out
    ]
    expect(rarityPointsInArc(items, 10)).toBe(4)
  })

  it('ages an item out exactly at the arc boundary', () => {
    expect(rarityPointsInArc([{ rarity: 'rare', grantedTurn: 0 }], ARC_LENGTH_TURNS)).toBe(0)
    expect(rarityPointsInArc([{ rarity: 'rare', grantedTurn: 0 }], ARC_LENGTH_TURNS - 1)).toBe(4)
  })

  it('ignores items the engine never metered', () => {
    // Everything predating this feature, and anything an admin handed over.
    // Budgeting retroactively against history nobody recorded would refuse
    // rewards for a reason no player could see.
    expect(rarityPointsInArc([{ rarity: 'legendary' }], 5)).toBe(0)
    expect(rarityPointsInArc([{ rarity: 'legendary', grantedTurn: null }], 5)).toBe(0)
  })

  it('is zero for a missing inventory', () => {
    expect(rarityPointsInArc(null, 5)).toBe(0)
  })
})

describe('applyGrantBudget', () => {
  it('grants freely inside the budget', () => {
    const result = applyGrantBudget([], [{ rarity: 'uncommon' }, { rarity: 'common' }], 5)
    expect(result.granted).toHaveLength(2)
    expect(result.skipped).toEqual([])
  })

  it('refuses what the arc can no longer afford', () => {
    // A legendary already granted this arc spends the whole budget.
    const existing = [{ rarity: 'legendary', grantedTurn: 5 }]
    const result = applyGrantBudget(existing, [{ rarity: 'common' }], 5)
    expect(result.granted).toEqual([])
    expect(result.skipped).toHaveLength(1)
  })

  it('spends the budget on the most items it can, cheapest first', () => {
    // Refusing three common items to make room for a legendary nobody can
    // afford would be the worst of both outcomes.
    const result = applyGrantBudget(
      [],
      [{ rarity: 'legendary' }, { rarity: 'common' }, { rarity: 'common' }, { rarity: 'common' }],
      1
    )
    expect(result.granted.map(i => i.rarity)).toEqual(['common', 'common', 'common'])
    expect(result.skipped.map(i => i.rarity)).toEqual(['legendary'])
  })

  it('lets exactly one legendary through on a fresh arc', () => {
    const result = applyGrantBudget([], [{ rarity: 'legendary' }, { rarity: 'legendary' }], 1)
    expect(result.granted).toHaveLength(1)
    expect(result.skipped).toHaveLength(1)
  })

  it('reopens the budget once the arc rolls over', () => {
    const existing = [{ rarity: 'legendary', grantedTurn: 0 }]
    expect(applyGrantBudget(existing, [{ rarity: 'rare' }], 5).granted).toHaveLength(0)
    expect(applyGrantBudget(existing, [{ rarity: 'rare' }], ARC_LENGTH_TURNS).granted).toHaveLength(1)
  })

  it('never blocks ordinary loot', () => {
    // The budget exists to make legendary items scarce, not to ration rope.
    const result = applyGrantBudget([], Array(8).fill({ rarity: 'common' }), 1)
    expect(result.skipped).toEqual([])
  })

  it('treats unrarity-tagged items as common', () => {
    const result = applyGrantBudget([], [{}, {}], 1)
    expect(result.granted).toHaveLength(2)
  })
})
