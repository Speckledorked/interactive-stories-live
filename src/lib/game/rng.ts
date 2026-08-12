// src/lib/game/rng.ts
// The injectable RNG seam shared by every dice roll in the engine.
//
// Split out from resolution.ts (#213) so harm.ts and worldUpdaters/
// characters.ts can depend on it without creating a cycle back through
// resolution.ts, which already imports from harm.ts. Everything that used
// to import Rng/rollD6 from resolution.ts still can — it re-exports both
// from here — this file is just where the actual definitions live now.

export type Rng = () => number

export function rollD6(rng: Rng): number {
  return Math.floor(rng() * 6) + 1
}
