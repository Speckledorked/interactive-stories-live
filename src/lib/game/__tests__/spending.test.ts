// src/lib/game/__tests__/spending.test.ts
// #416: the pure half of the spend surface.

import { describe, it, expect } from 'vitest'
import {
  PURCHASE_CATALOGUE,
  isPurchaseKind,
  priceOf,
  canAfford,
  offersFor,
  DEBT_SETTLEMENT_COST,
  HARM_TREATMENT_COST,
  HARM_TREATED_PER_PURCHASE,
} from '../spending'
import { DEFAULT_VALUE_BY_RARITY } from '../itemValue'

describe('the catalogue is closed (#416)', () => {
  it('is exactly the three entries, and the AI cannot add a fourth', () => {
    // Same discipline as BASIC_MOVES and COMMON_CONDITIONS. A spend surface
    // the narrator could extend would be an AI-authored mechanical change,
    // which is the thing this codebase refuses everywhere else.
    expect(PURCHASE_CATALOGUE.map((e) => e.kind)).toEqual([
      'settle_debt',
      'treat_harm',
      'commission_item',
    ])
  })

  it('rejects anything not in it', () => {
    expect(isPurchaseKind('settle_debt')).toBe(true)
    expect(isPurchaseKind('bribe_the_king')).toBe(false)
    expect(isPurchaseKind(undefined)).toBe(false)
    expect(isPurchaseKind({ kind: 'settle_debt' })).toBe(false)
  })
})

describe('priceOf — prices are pinned, not relational (#416)', () => {
  it('prices a debt settlement at the uncommon-item anchor', () => {
    // Gold has no canonical scale in this engine, so the prices are a claim
    // about RELATIVE cost anchored to DEFAULT_VALUE_BY_RARITY — the one
    // scale that already existed. Pinned so a retune is a visible diff.
    expect(DEBT_SETTLEMENT_COST).toBe(DEFAULT_VALUE_BY_RARITY.uncommon)
    expect(priceOf('settle_debt')).toEqual({ available: true, cost: 50 })
  })

  it('prices harm treatment superlinearly in the harm being treated', () => {
    expect(priceOf('treat_harm', { harm: 1 }).cost).toBe(10)
    expect(priceOf('treat_harm', { harm: 3 }).cost).toBe(80)
    expect(priceOf('treat_harm', { harm: 6 }).cost).toBe(1200)

    // The property, not just the numbers: each level costs strictly more
    // than the one below. A flat price would make gold a way to ignore the
    // harm track entirely.
    const costs = [1, 2, 3, 4, 5, 6].map((h) => HARM_TREATMENT_COST[h])
    for (let i = 1; i < costs.length; i++) {
      expect(costs[i]).toBeGreaterThan(costs[i - 1])
    }
  })

  it('offers nothing to treat at full health', () => {
    expect(priceOf('treat_harm', { harm: 0 })).toEqual({
      available: false,
      cost: 0,
      unavailableReason: 'Nothing to treat.',
    })
  })

  it('clamps a harm value above the track to the top of the table', () => {
    expect(priceOf('treat_harm', { harm: 99 }).cost).toBe(HARM_TREATMENT_COST[6])
  })

  it('prices equipment at its rarity tier', () => {
    expect(priceOf('commission_item', { rarity: 'common' }).cost).toBe(DEFAULT_VALUE_BY_RARITY.common)
    expect(priceOf('commission_item', { rarity: 'rare' }).cost).toBe(DEFAULT_VALUE_BY_RARITY.rare)
  })

  it('refuses to sell legendary at any price', () => {
    // itemValue.ts's per-arc grant budget exists to keep legendaries scarce.
    // A purchase route around it would make that budget advisory.
    const quote = priceOf('commission_item', { rarity: 'legendary' })

    expect(quote.available).toBe(false)
    expect(quote.unavailableReason).toContain('earned')
  })

  it('treats an unknown grade as unavailable rather than free', () => {
    expect(priceOf('commission_item', {}).available).toBe(false)
    expect(priceOf('commission_item', { rarity: 'mythic' as never }).available).toBe(false)
  })
})

describe('canAfford — no credit (#416)', () => {
  it('spends down to the exact balance', () => {
    expect(canAfford(50, priceOf('settle_debt'))).toEqual({ affordable: true, cost: 50, goldAfter: 0 })
  })

  it('refuses one gold short, and says by how much', () => {
    const result = canAfford(49, priceOf('settle_debt'))

    expect(result.affordable).toBe(false)
    expect(result.goldAfter).toBe(49)
    expect(result.reason).toContain('50')
    expect(result.reason).toContain('49')
  })

  it('never lends', () => {
    // Deliberate: this engine has a debt model with real mechanical weight
    // on every roll, so a purchase that silently minted a Debt row would be
    // the engine authoring an obligation the player never agreed to.
    expect(canAfford(0, priceOf('commission_item', { rarity: 'rare' })).affordable).toBe(false)
  })

  it('treats missing or malformed gold as none, not as infinite', () => {
    for (const gold of [undefined, null, NaN, -100]) {
      expect(canAfford(gold as never, priceOf('settle_debt')).affordable).toBe(false)
    }
  })

  it('is never affordable when the quote itself was unavailable', () => {
    const result = canAfford(1_000_000, priceOf('treat_harm', { harm: 0 }))

    expect(result.affordable).toBe(false)
    expect(result.reason).toBe('Nothing to treat.')
  })
})

describe('offersFor — blocked options stay visible (#416)', () => {
  it('shows every entry, with the unaffordable ones explained', () => {
    // Hiding what a player cannot afford teaches them the economy is
    // decorative, which is the exact impression this closes.
    const offers = offersFor(5, { harm: 3 })

    expect(offers).toHaveLength(PURCHASE_CATALOGUE.length)
    const settle = offers.find((o) => o.kind === 'settle_debt')!
    expect(settle.affordable).toBe(false)
    expect(settle.blockedReason).toContain('50')
  })

  it('marks what the character can actually take', () => {
    const offers = offersFor(10_000, { harm: 2 })

    expect(offers.filter((o) => o.affordable).map((o) => o.kind).sort()).toEqual([
      'commission_item',
      'settle_debt',
      'treat_harm',
    ])
  })

  it('explains a healthy character’s blocked treatment rather than pricing it', () => {
    const treat = offersFor(10_000, { harm: 0 }).find((o) => o.kind === 'treat_harm')!

    expect(treat.cost).toBe(0)
    expect(treat.affordable).toBe(false)
    expect(treat.blockedReason).toBe('Nothing to treat.')
  })

  it('quotes equipment at the entry grade so the row shows a real price', () => {
    const commission = offersFor(10_000).find((o) => o.kind === 'commission_item')!

    expect(commission.cost).toBe(DEFAULT_VALUE_BY_RARITY.common)
  })
})

describe('harm treatment is care, not resurrection (#416)', () => {
  it('removes exactly one level per purchase', () => {
    // A single payment taking a character from 6 to 0 would erase the
    // consequences the harm track exists to impose.
    expect(HARM_TREATED_PER_PURCHASE).toBe(1)
  })
})
