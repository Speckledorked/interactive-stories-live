// src/lib/game/conditionGates.ts
//
// Location condition as a real access gate (#206).
//
// #109 built locationConditionPenalty — a roll modifier for acting FROM a
// wrecked location — but nothing yet stopped a party from casually walking
// into or taking work out of one. This mirrors corruptionGates.ts's shape
// and boundary discipline (checked on ENTRY/ACQUISITION, never
// retroactively — a location can decay out from under a party without
// ejecting them) for the same reason: RUINED/ABANDONED are meant to mean
// something structurally, not just cost a die roll.
//
// Unlike corruption, condition gating is NOT universe-theme-dependent — a
// collapsed bridge or an emptied town is a physical fact in any setting,
// so there is no `hasTheme` equivalent here. It also never needs to be
// authored per-entity the way minCorruption/maxCorruption are: the gate is
// derived entirely from the same conditionScore/isContested pair
// deriveConditionTags already reads, so it can never drift out of sync
// with the tags a player or admin actually sees.

import { deriveConditionTags, type ConditionTag } from './tick/locationConditionTick'

/** Anything carrying the two fields deriveConditionTags needs. */
export interface ConditionGated {
  conditionScore: number
  isContested: boolean
}

export type ConditionRefusal = 'ruined' | 'abandoned'

export interface GateResult {
  allowed: boolean
  /** Why it was refused, or null when allowed. */
  refusal: ConditionRefusal | null
}

const ALLOWED: GateResult = { allowed: true, refusal: null }

// Only the two most severe bands actually block — DAMAGED/STABLE/
// PROSPEROUS are exactly the "worth a roll penalty, not worth turning
// anyone away" tier locationConditionPenalty already covers.
const BLOCKING_TAGS: Partial<Record<ConditionTag, ConditionRefusal>> = {
  ABANDONED: 'abandoned',
  RUINED: 'ruined',
}

/**
 * Can a character act against this entity at its current condition? Pure.
 *
 * An entity with no condition data (still being invented by the fiction,
 * or not a location at all) always passes — gating only ever applies once
 * a location has a real, persisted score.
 */
export function checkConditionGate(entity: ConditionGated | null | undefined): GateResult {
  if (!entity) return ALLOWED
  const tags = deriveConditionTags(entity.conditionScore, entity.isContested)
  for (const tag of tags) {
    const refusal = BLOCKING_TAGS[tag]
    if (refusal) return { allowed: false, refusal }
  }
  return ALLOWED
}

/**
 * In-fiction phrasing for a refusal. Never mentions numbers — same
 * discipline describeRefusal (corruptionGates.ts) follows for corruption.
 */
export function describeConditionRefusal(refusal: ConditionRefusal): string {
  return refusal === 'abandoned'
    ? 'there is nothing left here to reach — the place has been abandoned entirely'
    : 'the ruin is too unstable to risk — whatever business waits here will have to wait longer'
}
