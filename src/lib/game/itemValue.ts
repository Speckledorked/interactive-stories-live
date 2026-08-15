// src/lib/game/itemValue.ts
//
// Item value and rarity (the inventory half of the economy question,
// README #44/#47).
//
// Inventory had `armorValue`, `damageBonus` and `effect` — everything an
// item does in a fight — and nothing about what it's WORTH. So loot was
// weightless: a faction could hand out a priceless relic for free, the AI
// could grant a legendary artifact every scene, and "the party is carrying
// a fortune" was a sentence with no state behind it.
//
// The trap this had to avoid is the one the rest of this engine keeps
// finding: adding `value` and `rarity` as fields nothing reads would be
// exactly the fake depth being cleaned up everywhere else. So both fields
// arrive with consumers already attached:
//
//   1. Grant budget — a per-arc ceiling on how much rarity the AI can hand
//      out, the same guardrail shape as MAX_PERKS_PER_ARC. Without it a
//      narrator that likes rewarding players inflates the economy to
//      nothing within an arc, and no amount of pricing fixes that after
//      the fact.
//
//   2. Payout cost — an items-only reward used to cost a paying faction
//      NOTHING, which was a real hole in the transfer model: a bankrupt
//      faction could settle its debts in artifacts forever. Item value now
//      counts toward what a faction spends.
//
//   3. Carried wealth — a derived total for the prompt, so the narrator
//      knows whether these are people who can buy their way out of trouble.
//
// Deliberately NOT included: prices, merchants, haggling or trading. Those
// are a shopping system, which is a different product decision from "loot
// has worth". Value is a property of an item here, not a market.

export const RARITY_ORDER = ['common', 'uncommon', 'rare', 'legendary'] as const
export type ItemRarity = (typeof RARITY_ORDER)[number]

export function isItemRarity(value: unknown): value is ItemRarity {
  return typeof value === 'string' && (RARITY_ORDER as readonly string[]).includes(value)
}

/** Rank for comparisons and budgeting. common = 0 … legendary = 3. */
export function rarityRank(rarity: unknown): number {
  const index = RARITY_ORDER.indexOf(rarity as ItemRarity)
  return index === -1 ? 0 : index
}

/**
 * What an item of this rarity is worth when nothing said otherwise.
 *
 * Gold has no canonical scale in this engine (see economy.ts — genre
 * decides whether 200 gold is a fortune), so these are not a claim about
 * prices. They exist so that rarity alone is never free: an AI that says
 * "legendary" without naming a number has still said something expensive,
 * and the grant budget and payout cost both need a number to work with.
 */
export const DEFAULT_VALUE_BY_RARITY: Record<ItemRarity, number> = {
  common: 5,
  uncommon: 50,
  rare: 500,
  legendary: 5000,
}

/** Absolute ceiling on a single item's reported value — the same backstop-not-balance role clampGoldDelta plays. Rarely the binding constraint now that maxValueForRarity gates every tier well below it (see #277). */
export const MAX_ITEM_VALUE = 1_000_000

// #277: rarity and value are independently AI-controlled fields on the
// same response object, and applyGrantBudget spends against rarity alone
// (rarityPoints). Without this, an item reported as { rarity: 'common',
// value: 1_000_000 } cost the grant budget almost nothing yet contributed
// its full value to inventoryValue()/carried wealth and payout cost — a
// mechanical bypass of the exact mechanism this budget exists to enforce,
// reachable through ordinary AI narration with no prompt injection
// required. A reported value is now clamped against what its OWN rarity
// tier can plausibly be worth, with enough headroom over the tier's
// default to allow real narrative variance ("a particularly fine common
// dagger") without letting an under-reported rarity smuggle an outsized
// value past the budget it's supposed to gate.
const VALUE_HEADROOM_MULTIPLIER = 10

/**
 * Ceiling on what a reported value may claim for a given rarity tier.
 * Missing/invalid rarity clamps to the same cheapest tier rarityRank()
 * already falls back to — never a loophole to claim an unbounded value by
 * simply omitting rarity instead of under-reporting it.
 */
export function maxValueForRarity(rarity: unknown): number {
  const tier = isItemRarity(rarity) ? rarity : 'common'
  return Math.min(DEFAULT_VALUE_BY_RARITY[tier] * VALUE_HEADROOM_MULTIPLIER, MAX_ITEM_VALUE)
}

export interface ValuableItem {
  name?: string
  quantity?: number
  value?: number | null
  rarity?: string | null
}

/**
 * Unit value of an item: what was reported (clamped to what its rarity
 * tier can plausibly be worth), else what its rarity implies by default,
 * else nothing. Never negative — an item is not a liability.
 */
export function itemUnitValue(item: ValuableItem | null | undefined): number {
  if (!item) return 0
  const reported = Number(item.value)
  if (Number.isFinite(reported) && reported > 0) {
    return Math.min(Math.trunc(reported), maxValueForRarity(item.rarity))
  }
  if (isItemRarity(item.rarity)) return DEFAULT_VALUE_BY_RARITY[item.rarity]
  return 0
}

/** Unit value times quantity. A missing/malformed quantity counts as one. */
export function itemStackValue(item: ValuableItem | null | undefined): number {
  if (!item) return 0
  const qty = Math.max(1, Math.trunc(Number(item.quantity) || 1))
  return itemUnitValue(item) * qty
}

/** What a whole inventory is worth. Used for the prompt and for payout cost. */
export function inventoryValue(items: ValuableItem[] | null | undefined): number {
  if (!Array.isArray(items)) return 0
  return items.reduce((sum, item) => sum + itemStackValue(item), 0)
}

/**
 * Qualitative band for the prompt. Numbers stay server-side, consistent
 * with how proficiency and corruption are surfaced.
 */
export function describeWealth(total: number): string {
  if (total >= 10_000) return 'carrying a fortune'
  if (total >= 2_000) return 'well provisioned'
  if (total >= 300) return 'comfortable'
  if (total > 0) return 'travelling light'
  return 'carrying nothing of value'
}

// ---------------------------------------------------------------------------
// Grant budget
// ---------------------------------------------------------------------------

/**
 * How much rarity may be granted to one character per arc.
 *
 * Budgeted in RARITY POINTS rather than item count, so the ceiling limits
 * what actually matters: a fistful of common rope is not the thing that
 * breaks an economy, and one legendary blade is. Points are 2^rank, so a
 * legendary costs the whole budget and everything smaller composes
 * underneath it.
 *
 * Same arc length and philosophy as the advancement caps (#65): permanent
 * rewards are paced deterministically, because a narrator asked to be
 * generous will be generous every single scene.
 */
export const ARC_LENGTH_TURNS = 10
export const MAX_RARITY_POINTS_PER_ARC = 8

export function rarityPoints(rarity: unknown): number {
  return Math.pow(2, rarityRank(rarity))
}

/**
 * An item as it sits in a character's inventory for budgeting purposes.
 * `grantedTurn` is stamped when the engine grants it.
 */
export interface BudgetableItem {
  rarity?: string | null
  grantedTurn?: number | null
}

/**
 * Rarity points already spent on this character within the current arc.
 *
 * DERIVED from the inventory rather than tracked in a counter, the same
 * call countGrantsInArc makes for perks and moves (#65): a stored counter
 * is a second source of truth that drifts the moment an item is granted by
 * any path that forgets to increment it, or removed by one that forgets to
 * decrement. Items carry their own grant turn, so the budget is always a
 * true statement about the inventory in front of it.
 *
 * Items with no grantedTurn — everything that predates this, and anything
 * a player was given by an admin — count as nothing. Budgeting retroactively
 * against history the engine never metered would refuse rewards for a
 * reason no one could see.
 */
export function rarityPointsInArc(
  items: BudgetableItem[] | null | undefined,
  currentTurn: number
): number {
  if (!Array.isArray(items)) return 0
  return items.reduce((sum, item) => {
    // Explicitly reject null/undefined BEFORE coercing: Number(null) is 0,
    // which is finite, so an unstamped item would otherwise be read as
    // "granted on turn zero" and count against the budget for the first
    // arc of every campaign.
    const raw = item?.grantedTurn
    if (raw === null || raw === undefined) return sum
    const turn = Number(raw)
    if (!Number.isFinite(turn)) return sum
    if (currentTurn - turn >= ARC_LENGTH_TURNS) return sum
    return sum + rarityPoints(item?.rarity)
  }, 0)
}

export interface BudgetedGrant<T> {
  granted: T[]
  /** Items refused because the arc's rarity budget was spent. */
  skipped: T[]
  /** Points spent after this grant — for logging, not for storage. */
  pointsInArc: number
}

/**
 * Filter a batch of granted items down to what this arc's budget allows.
 *
 * Ordered cheapest-first so a budget that can't cover everything still
 * delivers the most items it can — refusing three common items to make
 * room for a legendary one nobody can afford would be the worst of both
 * outcomes.
 *
 * Pure. The caller stamps `grantedTurn` on what comes back, which is what
 * makes the next call's derivation correct.
 */
export function applyGrantBudget<T extends { rarity?: string | null }>(
  existingItems: BudgetableItem[] | null | undefined,
  incoming: T[],
  currentTurn: number
): BudgetedGrant<T> {
  let pointsInArc = rarityPointsInArc(existingItems, currentTurn)

  const granted: T[] = []
  const skipped: T[] = []
  const ordered = [...incoming].sort((a, b) => rarityRank(a.rarity) - rarityRank(b.rarity))

  for (const item of ordered) {
    const cost = rarityPoints(item.rarity)
    if (pointsInArc + cost <= MAX_RARITY_POINTS_PER_ARC) {
      pointsInArc += cost
      granted.push(item)
    } else {
      skipped.push(item)
    }
  }

  return { granted, skipped, pointsInArc }
}
