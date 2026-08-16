// src/lib/game/spending.ts
//
// #416: the missing half of the economy — a way for a player to SPEND.
//
// The audit's own reckoning called the debt-and-standing economy the
// strongest claim in ARCHITECTURE.md: `Faction.resources`, `FactionDebt`
// with a real per-tick loan/default loop, character-side `Debt` that is
// mechanically binding on the roll, `assessPayout`'s partial-payment and
// default logic. All real, all load-bearing. And that is exactly what made
// "no merchant/trading layer — a deliberate scope decision, not a gap" not
// hold up: the system models earning, owing, defaulting and the reputation
// consequences of all three, and offered no modelled way to convert money
// into anything. Gold accumulated and only ever left through an AI-narrated
// delta, which is to say it never really left.
//
// ── What this is NOT ──────────────────────────────────────────────────────
//
// Not a marketplace. itemValue.ts already drew this boundary once and drew
// it correctly: "prices, merchants, haggling or trading… are a shopping
// system, which is a different product decision from 'loot has worth'."
// That still stands. A general market needs inventories, restocking,
// regional pricing and haggling rolls, and none of those close the loop the
// audit found open.
//
// It is also NOT routed through `Transaction`, which the issue suggested.
// Worth stating, because the suggestion is a natural misreading of the
// name: `Transaction` is the SaaS BILLING ledger — real money, in cents,
// keyed by `userId`, with `CREDIT`/`DEBIT`/`REFUND`/`ADJUSTMENT` for AI
// usage charges. Putting in-fiction gold through it would mix a player's
// payment history with their character's purse, in a table whose rows are
// financial records. In-fiction spending goes through the in-fiction
// models: `Character.resources.gold` and `Debt`.
//
// ── What it IS ────────────────────────────────────────────────────────────
//
// A CLOSED CATALOGUE of purchases, each of which changes a number the
// engine already reads, priced deterministically from state the engine
// already owns. Closed in the same sense as `BASIC_MOVES`,
// `COMMON_CONDITIONS` and `FAMILY_QUESTIONS`: the AI cannot add an entry,
// cannot set a price, and cannot apply an effect. It can narrate a
// transaction the engine already made.
//
// Three entries, chosen because each closes a loop that is currently open
// at one end:
//
//   settle_debt      The strongest one, and the reason this file exists.
//                    A character's outstanding Debt is mechanically binding
//                    (debtModifier, ±1/±2 on every roll with that
//                    counterparty) and there was no way to discharge one by
//                    paying. You could owe forever and only ever narrate
//                    your way out.
//   treat_harm       Harm is the engine's most consequential track and
//                    healing it was entirely at the narrator's discretion
//                    (`harm_healing` is one of the AI-reported fields this
//                    codebase most distrusts). Paying for care is the
//                    deterministic route.
//   commission_item  Turns gold into carried wealth at a known rate, which
//                    is what makes gold a resource rather than a score.
//                    Priced off DEFAULT_VALUE_BY_RARITY so it cannot be
//                    used to launder value into the party.
//
// Every price is a pure function of state. Nothing here rolls dice, calls
// the AI, or reads a field the AI wrote in this scene.

import { DEFAULT_VALUE_BY_RARITY, type ItemRarity } from './itemValue'
import { applyGoldDelta } from './economy'

export type PurchaseKind = 'settle_debt' | 'treat_harm' | 'commission_item'

export interface PurchaseCatalogueEntry {
  kind: PurchaseKind
  label: string
  /** One line of player-facing explanation of what the money does. */
  effect: string
}

export const PURCHASE_CATALOGUE: readonly PurchaseCatalogueEntry[] = [
  {
    kind: 'settle_debt',
    label: 'Settle a debt',
    effect: 'Discharges one favor you owe, and the roll penalty that came with it.',
  },
  {
    kind: 'treat_harm',
    label: 'Pay for care',
    effect: 'Removes one level of harm. Costs more the worse the injury.',
  },
  {
    kind: 'commission_item',
    label: 'Commission equipment',
    effect: 'Buys a piece of gear at its rarity’s going rate.',
  },
]

export function isPurchaseKind(value: unknown): value is PurchaseKind {
  return PURCHASE_CATALOGUE.some((entry) => entry.kind === value)
}

// ── Pricing ───────────────────────────────────────────────────────────────
//
// Gold has no canonical scale in this engine — economy.ts and itemValue.ts
// both say so, and both are right: genre decides whether 200 gold is
// trivial or a fortune. So these are not a claim about what things cost in
// a world. They are a claim about RELATIVE cost, anchored to the one scale
// that already exists: DEFAULT_VALUE_BY_RARITY. A debt costs about an
// uncommon item; clearing the worst harm costs about a rare one. Retuning
// them is a deliberate act with a visible diff, and spending.test.ts pins
// them.

/** What discharging one outstanding favor costs. */
export const DEBT_SETTLEMENT_COST = DEFAULT_VALUE_BY_RARITY.uncommon

/**
 * What removing one level of harm costs, by the harm level being treated.
 *
 * Steeply superlinear on purpose. Harm 1 is a scrape and should be cheap
 * enough to be routine; harm 5 is one step from the end of a character and
 * should be a decision that costs the party something. A flat price would
 * make gold a way to ignore the harm track, which is the failure mode any
 * "pay to heal" system has to avoid.
 */
export const HARM_TREATMENT_COST: Record<number, number> = {
  1: 10,
  2: 30,
  3: 80,
  4: 200,
  5: 500,
  6: 1200,
}

/**
 * The most harm one payment can treat. Care is care, not resurrection —
 * and a single purchase that took a character from 6 to 0 would erase the
 * consequences the whole track exists to impose.
 */
export const HARM_TREATED_PER_PURCHASE = 1

export interface PriceContext {
  /** Current harm, for treat_harm. */
  harm?: number
  /** Rarity being commissioned, for commission_item. */
  rarity?: ItemRarity
}

export interface PriceQuote {
  available: boolean
  /** Cost in gold. Zero when unavailable. */
  cost: number
  /** Why not, when unavailable — player-facing. */
  unavailableReason?: string
}

/**
 * Pure: what this purchase costs for this character right now, or why it is
 * not on offer. Never throws — an unpriceable request is an unavailable
 * one, not an error, because the catalogue is rendered from this.
 */
export function priceOf(kind: PurchaseKind, context: PriceContext = {}): PriceQuote {
  switch (kind) {
    case 'settle_debt':
      return { available: true, cost: DEBT_SETTLEMENT_COST }

    case 'treat_harm': {
      const harm = Math.trunc(Number(context.harm) || 0)
      if (harm <= 0) {
        return { available: false, cost: 0, unavailableReason: 'Nothing to treat.' }
      }
      const cost = HARM_TREATMENT_COST[Math.min(harm, 6)]
      return { available: true, cost }
    }

    case 'commission_item': {
      const rarity = context.rarity
      if (!rarity || !(rarity in DEFAULT_VALUE_BY_RARITY)) {
        return { available: false, cost: 0, unavailableReason: 'No such grade of equipment.' }
      }
      if (rarity === 'legendary') {
        // The one thing money cannot buy. A legendary item is a story
        // outcome — the grant budget in itemValue.ts exists precisely to
        // keep them scarce, and a purchase route around it would make that
        // budget advisory.
        return {
          available: false,
          cost: 0,
          unavailableReason: 'Nobody sells the legendary. That has to be earned.',
        }
      }
      return { available: true, cost: DEFAULT_VALUE_BY_RARITY[rarity] }
    }
  }
}

export interface AffordabilityResult {
  affordable: boolean
  cost: number
  goldAfter: number
  reason?: string
}

/**
 * Pure: can this character pay, and what is left afterwards?
 *
 * No credit. Deliberately: this engine already has a debt model with real
 * mechanical weight, and letting a purchase silently mint a new Debt row
 * would be the engine authoring an obligation the player never agreed to.
 * If owing someone for a purchase becomes a feature, it should be a
 * separate, explicit choice with its own catalogue entry.
 */
export function canAfford(currentGold: number | null | undefined, quote: PriceQuote): AffordabilityResult {
  const gold = typeof currentGold === 'number' && Number.isFinite(currentGold) ? Math.max(0, Math.trunc(currentGold)) : 0

  if (!quote.available) {
    return { affordable: false, cost: 0, goldAfter: gold, reason: quote.unavailableReason ?? 'Not available.' }
  }
  if (gold < quote.cost) {
    return {
      affordable: false,
      cost: quote.cost,
      goldAfter: gold,
      reason: `Costs ${quote.cost} gold; you have ${gold}.`,
    }
  }
  return { affordable: true, cost: quote.cost, goldAfter: applyGoldDelta(gold, -quote.cost) }
}

export interface CatalogueOffer extends PurchaseCatalogueEntry {
  cost: number
  affordable: boolean
  /** Present when the offer cannot be taken — either unavailable or unaffordable. */
  blockedReason?: string
}

/**
 * Pure: the whole catalogue, priced for one character, with the ones they
 * cannot take marked and explained rather than hidden. Showing a blocked
 * option with its reason is what tells a player that gold DOES something —
 * hiding it teaches them the economy is decorative, which is the exact
 * impression this file exists to correct.
 */
export function offersFor(
  currentGold: number | null | undefined,
  context: PriceContext & { rarities?: readonly ItemRarity[] } = {}
): CatalogueOffer[] {
  return PURCHASE_CATALOGUE.map((entry) => {
    // commission_item is priced per rarity; the catalogue view quotes the
    // cheapest grade on offer so the row shows an entry price.
    const rarity =
      entry.kind === 'commission_item' ? (context.rarities?.[0] ?? context.rarity ?? 'common') : context.rarity
    const quote = priceOf(entry.kind, { ...context, rarity })
    const affordability = canAfford(currentGold, quote)
    return {
      ...entry,
      cost: quote.cost,
      affordable: affordability.affordable,
      ...(affordability.affordable ? {} : { blockedReason: affordability.reason }),
    }
  })
}
