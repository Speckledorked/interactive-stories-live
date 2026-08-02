// src/lib/game/worldStateChanges.ts
//
// The one place that knows how world-state changes are stored inside a
// scene's untyped `consequences` Json blob (README #61).
//
// Deliberately its own module with no runtime imports: the consumers are a
// server-side accessor (world-state-tracker.ts, which imports Prisma) and a
// 'use client' page. Putting this in world-state-tracker would drag the
// Prisma client into the browser bundle; `import type` below is erased at
// compile time, so this file stays free of runtime dependencies.

import type { WorldStateChange } from '@/components/scene/AITransparencyPanel'
import type { AdherenceResult } from './outcomeAdherence'

/**
 * Pull the world-state changes out of a scene's `consequences` blob.
 *
 * Pure. Tolerates a missing or malformed value rather than trusting the
 * blob's shape — the whole point of having one extractor is that callers
 * stop reaching into an untyped object by hand and breaking silently when
 * that shape changes.
 */
export function extractWorldStateChanges(consequences: unknown): WorldStateChange[] {
  const changes = (consequences as any)?.worldStateChanges
  return Array.isArray(changes) ? changes : []
}

/**
 * Pull the outcome-adherence result (#91) out of the same blob — did the
 * narration actually match the roll it was told was binding? Same
 * tolerate-anything-malformed shape as extractWorldStateChanges: an older
 * scene resolved before this field existed simply has none, and that's a
 * valid, silent "nothing to show" rather than an error.
 */
export function extractOutcomeAdherence(consequences: unknown): AdherenceResult | null {
  const adherence = (consequences as any)?.outcomeAdherence
  if (!adherence || !Array.isArray(adherence.entries)) return null
  return adherence as AdherenceResult
}
