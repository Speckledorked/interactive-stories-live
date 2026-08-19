// src/lib/game/economy.ts
// Shared gold-delta guardrail. Unlike PbtA stats (fixed -2..3) or the
// fixed 0-6 harm track, this engine has no canonical gold scale — genre
// and campaign decide whether 200 gold is trivial or a fortune, so this
// is deliberately NOT a game-balance cap. It exists purely as a backstop
// against a clearly malformed or hallucinated number (NaN/Infinity, or a
// magnitude that couldn't be a real narrative payout/cost) reaching a
// character's resources unclamped — every other magnitude field in this
// engine (harm, corruption, standing, relationships) already has an
// equivalent guardrail; gold_delta/reward_grant.gold were the one
// remaining place without one.
export const MAX_GOLD_DELTA_MAGNITUDE = 100_000

/**
 * Clamp a single reported gold change to a sane magnitude. Non-finite
 * input (NaN, Infinity, missing) becomes 0 rather than propagating a
 * broken value into a character's resources.
 */
export function clampGoldDelta(delta: number | null | undefined): number {
  if (delta === null || delta === undefined || !Number.isFinite(delta)) return 0
  return Math.max(-MAX_GOLD_DELTA_MAGNITUDE, Math.min(MAX_GOLD_DELTA_MAGNITUDE, Math.trunc(delta)))
}

/**
 * Apply a reported gold delta to a current balance and return the new
 * balance — clamped-magnitude delta, floored at 0 (gold can never go
 * negative). #223: the negative-gold guarantee used to be a
 * `Math.max(0, current + clampGoldDelta(delta))` pattern duplicated at
 * every balance-mutation call site (worldUpdaters/characters.ts,
 * questRewards.ts, downtime/downtimeRewards.ts) — a convention every new
 * caller had to remember to repeat, not something clampGoldDelta itself
 * enforced. This is the single place that guarantee now lives.
 *
 * Deliberately a separate function from clampGoldDelta, not a change to
 * it: clampGoldDelta alone is still the right tool wherever a caller needs
 * a clamped DELTA on its own (e.g. flooring a reward grant's own gold
 * value at 0, not a balance).
 */
export function applyGoldDelta(currentGold: number | null | undefined, delta: number | null | undefined): number {
  const current = typeof currentGold === 'number' && Number.isFinite(currentGold) ? currentGold : 0
  return Math.max(0, current + clampGoldDelta(delta))
}

/**
 * The outcome of trying to SPEND, which is a different question from
 * applying a delta.
 *
 * applyGoldDelta floors the result at 0, which is right for a credit and
 * wrong for a purchase: spending 200 with 50 in hand silently produced a
 * balance of 0 and let the purchase happen anyway. A player could never be
 * refused, only drained — so "I cannot afford this" never became a reason to
 * bargain, borrow, lie or steal, which is the pressure an economy is for.
 *
 * This makes the refusal representable. It does not decide what the fiction
 * then does about it; that is the caller's business.
 */
export interface SpendOutcome {
  /** The balance after the attempt. Unchanged when refused. */
  gold: number
  /** How much actually left the purse — 0 when refused. */
  spent: number
  /** True when the character could not cover the cost and nothing was taken. */
  refused: boolean
  /** How much short they were. 0 unless refused. */
  shortfall: number
}

/**
 * Attempt to spend `cost` from `currentGold`, all-or-nothing.
 *
 * All-or-nothing on purpose. Partial payment would leave the fiction in an
 * incoherent state — the item half-bought, the debt half-settled — and it is
 * the exact behaviour being fixed: taking everything the character has and
 * calling it a completed purchase.
 *
 * `cost` is normalised through clampGoldDelta's magnitude guardrail and read
 * as a positive amount, so a caller passing -50 or 50 means the same thing.
 */
export function spendGold(currentGold: number | null | undefined, cost: number | null | undefined): SpendOutcome {
  const current = typeof currentGold === 'number' && Number.isFinite(currentGold) ? Math.max(0, currentGold) : 0
  const amount = Math.abs(clampGoldDelta(cost))

  if (amount === 0) return { gold: current, spent: 0, refused: false, shortfall: 0 }
  if (amount > current) {
    return { gold: current, spent: 0, refused: true, shortfall: amount - current }
  }
  return { gold: current - amount, spent: amount, refused: false, shortfall: 0 }
}
