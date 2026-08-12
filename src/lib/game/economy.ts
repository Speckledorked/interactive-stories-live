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
