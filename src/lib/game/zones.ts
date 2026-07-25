// src/lib/game/zones.ts
//
// Abstract range bands, and the roll modifier they actually produce
// (README #2, #43, #85).
//
// A ZoneManager class used to live in exchange-manager.ts with close/near/
// far/distant, a zone-distance helper, and a "narrative advantage"
// calculator. It had zero consumers: nothing set a character's zone,
// nothing read it, and the advantage it computed was a string nobody
// displayed. This is that concept rebuilt as something the dice feel.
//
// Three deliberate choices, each avoiding the trap the old version fell in:
//
//  1. ONE position, not two. The old system asked for an attacker zone AND
//     a target zone, which meant NPCs needed zones too — and nothing in
//     this engine gives NPCs positions, so the function could never be
//     called with real arguments. Here a zone is the acting character's
//     distance from the center of the action, and the modifier falls out of
//     that alone. Self-contained, so it can actually be evaluated.
//
//  2. A modifier, not an "advantage" string. `{ hasAdvantage, description }`
//     was presentation wearing a mechanic's clothes. This returns a number
//     that lands in the total, shows up in the roll receipt, and is
//     auditable in the DiceRoll row like every other modifier.
//
//  3. It composes with the existing modifiers instead of introducing a new
//     scale — same ±1 idiom as weather, harm and contested ground. The one
//     -2 is reserved for the genuinely absurd (swinging a sword at someone
//     across the plaza), which should cost more than bad weather.
//
// The grid (Map/Zone/Token) remains the literal positioning model for
// battle maps; this is the abstract one that governs rolls. They answer
// different questions and never need to reconcile — which is what #85
// asked for, arrived at by making each one's job explicit rather than by
// deleting one of them.

export type ZonePosition = 'close' | 'near' | 'far' | 'distant'

/** Ordered outward from the center of the action. */
export const ZONE_ORDER: ZonePosition[] = ['close', 'near', 'far', 'distant']

/**
 * Where a character stands when nothing has said otherwise: engaged with
 * the scene but not on top of anyone. Chosen because it's the only band
 * that penalizes nothing — a character whose position was never
 * established should not be quietly handed a bonus or a penalty.
 */
export const DEFAULT_ZONE: ZonePosition = 'near'

/** How an action reaches its target. `null` for anything that isn't reaching. */
export type Engagement = 'melee' | 'ranged' | 'social' | null

export function isZonePosition(value: unknown): value is ZonePosition {
  return typeof value === 'string' && (ZONE_ORDER as string[]).includes(value)
}

/** Coerce stored/AI-supplied values to a real zone, defaulting rather than throwing. */
export function parseZone(value: unknown): ZonePosition {
  return isZonePosition(value) ? value : DEFAULT_ZONE
}

export function isEngagement(value: unknown): value is Exclude<Engagement, null> {
  return value === 'melee' || value === 'ranged' || value === 'social'
}

/** Bands apart. Kept exported because the prompt describes distance in these terms. */
export function zoneDistance(a: ZonePosition, b: ZonePosition): number {
  return Math.abs(ZONE_ORDER.indexOf(a) - ZONE_ORDER.indexOf(b))
}

/**
 * The modifier a character's position contributes to a roll, given how the
 * action reaches.
 *
 * Reading the table: melee wants to be on top of the target and degrades
 * with every band; ranged wants a middle distance and is penalized both by
 * being crowded (no room to aim or draw) and by extreme range; social
 * follows melee's shape because a conversation is also something you have
 * to be present for. An action with no reach — bracing a door, reading a
 * ledger, holding your nerve — is unaffected, which is most actions.
 *
 * Deliberately NOT a per-move lookup. Deciding from a move's name whether
 * "Act Under Fire" is melee or ranged is exactly the keyword guesswork this
 * codebase avoids elsewhere; the classifier reads the fiction and says.
 */
export function rangeModifier(zone: ZonePosition, engagement: Engagement): number {
  if (!engagement) return 0
  switch (engagement) {
    case 'melee':
      return { close: 1, near: 0, far: -1, distant: -2 }[zone]
    case 'ranged':
      return { close: -1, near: 1, far: 1, distant: -1 }[zone]
    case 'social':
      return { close: 1, near: 0, far: -1, distant: -2 }[zone]
  }
}

/** In-fiction phrasing for the prompt and the roll receipt. */
export function describeZone(zone: ZonePosition): string {
  switch (zone) {
    case 'close': return 'in the thick of it'
    case 'near': return 'close at hand'
    case 'far': return 'across the space'
    case 'distant': return 'far off'
  }
}

/**
 * What we remember about a character's position beyond the band itself.
 *
 * `sceneId` is what makes positions scene-scoped without needing a hook in
 * scene creation: a stored zone from a different scene is stale by
 * definition — you don't start the next confrontation still pressed against
 * the same doorway — so it resolves back to DEFAULT_ZONE on read. `note` is
 * the fiction's own words for where they are ("behind the overturned
 * cart"), carried into the prompt so the narrator can stay consistent with
 * a position the dice already priced.
 */
export interface ZoneMetadata {
  sceneId?: string
  note?: string
}

/**
 * The zone a character actually occupies for a roll in this scene.
 *
 * Order of authority: an explicit reposition in this action beats the
 * stored zone, and a stored zone from another scene doesn't count at all.
 */
export function resolveZoneForScene(params: {
  storedZone: unknown
  storedMetadata: unknown
  sceneId: string
  movesTo?: unknown
}): ZonePosition {
  if (isZonePosition(params.movesTo)) return params.movesTo
  const meta = (params.storedMetadata || {}) as ZoneMetadata
  if (meta.sceneId !== params.sceneId) return DEFAULT_ZONE
  return parseZone(params.storedZone)
}
