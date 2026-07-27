// src/lib/game/factionPayout.ts
//
// The missing edge between the faction simulation and player wealth
// (README #44, #47, #76, #77 — the faction-wealth half of that cluster).
//
// What was actually true before this: `Faction.resources` is NOT a dead
// field. It's read all over the simulation — ambition commitment
// thresholds, per-goal drift, war outcomes, absorption transfer on
// collapse. What it never did was reach a player. A faction could be
// bankrupt and still hand out a 500-gold reward, and paying that reward
// cost the faction nothing. Gold appeared from nowhere and vanished into
// nowhere, which is what made "the economy doesn't connect" true even
// though both halves were individually simulated.
//
// This closes exactly that one edge and deliberately nothing else. Debt
// still carries no roll weight, and items still have no value or rarity —
// those are open product questions, and building them incrementally under
// cover of this change would be answering them by stealth.
//
// The design in one line: a payout is a TRANSFER. What a faction pays,
// it stops having.

import { clamp } from '@/lib/game/tick/types'

/** Faction.resources is a 0-100 band, not a treasury denominated in gold. */
export const RESOURCES_MIN = 0
export const RESOURCES_MAX = 100

/**
 * Below this, a faction is genuinely broke and cannot honor what it
 * promised in full. Set at the same place `factionTick` already treats as
 * meaningful weakness rather than inventing a new threshold.
 */
export const BROKE_THRESHOLD = 25

/**
 * How much gold one point of faction resources is worth.
 *
 * There is no canonical gold scale in this engine (see economy.ts —
 * genre decides whether 200 gold is trivial or a fortune), so this is not
 * a claim about what money is worth. It's the exchange rate that makes a
 * payout visible in the faction's own units: at 100, a routine few-hundred
 * gold job costs a healthy faction a couple of points, and bankrolling the
 * party repeatedly visibly drains them.
 */
export const GOLD_PER_RESOURCE_POINT = 100

/**
 * A single payout can never cost a faction more than this many points, no
 * matter how large the reward. Without it one hallucinated 100,000-gold
 * grant (clampGoldDelta's ceiling) would zero a faction's resources in one
 * turn and cascade straight into war outcomes and ambition thresholds —
 * an AI text field should not be able to collapse an institution.
 */
export const MAX_RESOURCE_COST_PER_PAYOUT = 15

export interface PayoutAssessment {
  /** What the fiction promised. */
  promised: number
  /** What the character actually receives. */
  paid: number
  /** promised - paid. Non-zero means the faction defaulted. */
  shortfall: number
  /** Resource points the faction loses. Never more than it has. */
  resourceCost: number
  /** True when the faction could not pay in full. */
  defaulted: boolean
}

/**
 * What a faction can actually afford of what it promised.
 *
 * A healthy faction pays in full. A broke one pays what it has and
 * defaults on the rest — deliberately a PARTIAL payment rather than
 * nothing, because a faction that stiffs the party completely is a story
 * beat the narrator should be choosing, while "they scraped together what
 * they could" is what being poor actually looks like.
 *
 * Pure. `resources` is the faction's current 0-100 band.
 */
export function assessPayout(promised: number, resources: number): PayoutAssessment {
  const want = Math.max(0, Math.trunc(Number(promised) || 0))
  const have = clamp(Number(resources) || 0, RESOURCES_MIN, RESOURCES_MAX)

  if (want === 0) {
    return { promised: 0, paid: 0, shortfall: 0, resourceCost: 0, defaulted: false }
  }

  // Everything a faction could pay if it emptied itself, in gold.
  const capacity = have * GOLD_PER_RESOURCE_POINT
  const paid = Math.min(want, capacity)

  // Cost in the faction's own units, rounded UP: a payout must never be
  // free through rounding, or a faction could bankroll the party forever
  // in small increments without the simulation noticing.
  const rawCost = Math.ceil(paid / GOLD_PER_RESOURCE_POINT)
  const resourceCost = Math.min(rawCost, MAX_RESOURCE_COST_PER_PAYOUT, have)

  return {
    promised: want,
    paid,
    shortfall: want - paid,
    resourceCost,
    defaulted: paid < want,
  }
}

/**
 * Whether a faction is visibly unable to meet its obligations — for the
 * prompt, so the narrator can play a struggling patron as struggling
 * instead of discovering it only at payout time.
 */
export function isBroke(resources: number): boolean {
  return clamp(Number(resources) || 0, RESOURCES_MIN, RESOURCES_MAX) < BROKE_THRESHOLD
}

/** One line for the resolution summary when a faction couldn't pay in full. */
export function describeDefault(factionName: string, assessment: PayoutAssessment): string {
  return (
    `${factionName} could only raise ${assessment.paid} of the ${assessment.promised} promised ` +
    `(${assessment.shortfall} short) — their coffers are not what they were`
  )
}
