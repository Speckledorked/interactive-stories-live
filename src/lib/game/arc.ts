// src/lib/game/arc.ts
// World Sim #119 — signed push / contested value model.
//
// A generic primitive for any signed, multi-actor "tug of war" value that
// gets pushed in opposite directions by two sides each tick — the shape
// War.momentum already established (military edge + deterministic
// variance, clamped, resolved decisively past a threshold or by timeout).
// Extracted here as pure, reusable push/resolve functions so a NEW
// contested value (tick/territoryLoyaltyTick.ts) doesn't reinvent this
// arithmetic, and so decideWarProgress/decideWarResolution in
// tick/warTick.ts can delegate to the exact same math instead of keeping
// a second, independently-drifting copy of it.
//
// Deliberately not a storage migration for War itself — see Arc's schema
// comment for why War.momentum stays a plain Int column.

import { clamp, stableHash } from './tick/types'

export const ARC_VALUE_MIN = -100
export const ARC_VALUE_MAX = 100

export interface ArcPushSides {
  /** Positive delta favors side A; negative favors side B. */
  sideAStrength: number
  sideBStrength: number
}

export interface ArcPushOptions {
  /** How much of the raw strength edge converts into delta per tick. War uses 0.2. */
  edgeWeight?: number
  /** Hard cap on how far the value can move in a single tick, in either direction. War uses 20. */
  maxSwingPerTick?: number
  /** Half-width of the deterministic variance term (so the full spread is 2x+1 values). War uses 10. */
  varianceSpread?: number
}

/**
 * Pure — one tick's signed delta for a two-sided tug-of-war arc. The
 * strength edge between two sides is scaled down and summed with a
 * deterministic variance term seeded by (arcId, turnNumber) — reproducible
 * without Math.random(), consistent with the rest of this codebase's tick
 * logic — then clamped to a bounded per-tick swing. Does NOT apply the
 * delta to any particular current value; the caller decides that (mirrors
 * decideWarProgress's existing contract, which only ever returns a delta).
 */
export function decideArcDelta(arcId: string, turnNumber: number, sides: ArcPushSides, options: ArcPushOptions = {}): number {
  const edgeWeight = options.edgeWeight ?? 0.2
  const maxSwingPerTick = options.maxSwingPerTick ?? 20
  const varianceSpread = options.varianceSpread ?? 10

  const strengthEdge = sides.sideAStrength - sides.sideBStrength
  const varianceRange = varianceSpread * 2 + 1
  const variance = (stableHash(`${arcId}:${turnNumber}`) % varianceRange) - varianceSpread

  return clamp(Math.round(strengthEdge * edgeWeight) + variance, -maxSwingPerTick, maxSwingPerTick)
}

/** Pure — apply a delta to an arc's current value, clamped to its overall range. */
export function applyArcDelta(currentValue: number, delta: number, min: number = ARC_VALUE_MIN, max: number = ARC_VALUE_MAX): number {
  return clamp(currentValue + delta, min, max)
}

export interface ArcResolution {
  resolves: boolean
  /** 'A' or 'B' on a decisive swing, 'stalemate' on timeout, null while still undecided. */
  winner: 'A' | 'B' | 'stalemate' | null
}

/**
 * Pure — whether an arc has resolved decisively (|value| past
 * decisiveThreshold, in whichever direction) or timed out into a
 * stalemate (turnsElapsed >= maxDuration). Mirrors decideWarResolution's
 * exact shape (>= threshold checked first, timeout second).
 */
export function decideArcResolution(
  valueAfterPush: number,
  turnsElapsed: number,
  decisiveThreshold: number,
  maxDuration: number
): ArcResolution {
  if (Math.abs(valueAfterPush) >= decisiveThreshold) {
    return { resolves: true, winner: valueAfterPush > 0 ? 'A' : 'B' }
  }
  if (turnsElapsed >= maxDuration) {
    return { resolves: true, winner: 'stalemate' }
  }
  return { resolves: false, winner: null }
}
