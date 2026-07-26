// src/lib/api/visibility.ts
//
// Fog of war, in one place (#94).
//
// "Hidden factions/NPCs/locations never reach player-facing responses,
// enforced at the query layer" is this product's headline claim, and it was
// true — audited route by route — while being implemented as **23
// hand-written where-clauses across 11 files** with no shared helper and no
// test. Correct today, resting entirely on every future route author
// remembering. That is the duplicated-rule pattern the rest of this
// codebase keeps eliminating, sitting at the one layer where drift is a
// data leak rather than a wrong number.
//
// Two things live here that a route author should not have to know:
//
//  1. **Which column gates which model.** Clocks hide behind `isHidden`
//     while NPCs, factions and locations reveal behind `isDiscovered` —
//     opposite polarity, different names. Getting that inverted leaks, and
//     it is exactly the kind of detail that gets copied wrong.
//
//  2. **That an unknown role means "not an admin".** The default is
//     restrictive on purpose: a missing or malformed role must fail closed,
//     because the failure mode of guessing generously is showing a player
//     the GM's hidden clocks.
//
// Dependency-free (no Prisma import) so a client component can share the
// vocabulary without dragging the database client into the browser bundle —
// the same split as worldStateChanges.ts and campaignHealthBands.ts.

/** The models whose rows are hidden from players until revealed. */
export type FogGatedModel = 'npc' | 'faction' | 'location' | 'clock'

/**
 * Membership roles as stored on CampaignMembership. Only ADMIN sees
 * through the fog; every other role, and no role at all, does not.
 */
export type CampaignRole = string | null | undefined

/**
 * Which column gates each model, and what value means "visible to a
 * player". Kept as data rather than a switch so the polarity difference is
 * stated once, in a form that is hard to misread.
 */
const FOG_COLUMN: Record<FogGatedModel, { column: string; visibleValue: boolean }> = {
  npc: { column: 'isDiscovered', visibleValue: true },
  faction: { column: 'isDiscovered', visibleValue: true },
  location: { column: 'isDiscovered', visibleValue: true },
  // Inverted: a clock is hidden when isHidden is true.
  clock: { column: 'isHidden', visibleValue: false },
}

export function isCampaignAdmin(role: CampaignRole): boolean {
  return role === 'ADMIN'
}

/**
 * The `where` fragment that limits a query to what this role may see.
 *
 * Returns `{}` for an admin — deliberately an empty fragment rather than a
 * separate code path, so a caller spreads it unconditionally and cannot
 * forget the non-admin branch:
 *
 *     where: { campaignId, ...visibleTo('npc', membership.role) }
 *
 * That shape is the point. The previous idiom put the decision at the call
 * site (`isAdmin ? {} : { isDiscovered: true }`), which is one ternary away
 * from being written backwards.
 */
export function visibleTo(model: FogGatedModel, role: CampaignRole): Record<string, boolean> {
  if (isCampaignAdmin(role)) return {}

  const gate = FOG_COLUMN[model]
  // An unrecognised model is a programming error, and the safe response to
  // one is not "return everything". Fail closed on an impossible filter
  // rather than silently lifting the fog.
  if (!gate) return { __unknownFogGatedModel: true }

  return { [gate.column]: gate.visibleValue }
}

/**
 * Every fog-gated model, for callers that need to iterate — the wiki's
 * name index, for instance, which asks all four the same question.
 */
export const FOG_GATED_MODELS = Object.keys(FOG_COLUMN) as FogGatedModel[]
