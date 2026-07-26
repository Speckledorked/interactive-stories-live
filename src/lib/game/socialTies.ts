// src/lib/game/socialTies.ts
//
// NPC society, made mechanically real (README #89).
//
// `NPC.socialTies` records who each major NPC counts as an ALLY or a RIVAL,
// derived from faction politics by npcSocietyTick. It was read in exactly
// three places: the tick that writes it, one flavor sentence on the wiki,
// and joint-scheme clock spawning. It never reached a dice roll or any
// other player-facing mechanic — real, but far narrower than the schema
// comment implies.
//
// This is the missing consumer, and it's the obvious one: **rapport
// propagates through the graph.** If you did right by someone, their
// friends have heard about it, and so have their enemies. The party's
// social standing stops being a set of unconnected one-to-one meters and
// starts being a position in a society that talks to itself.
//
// Two properties this deliberately keeps:
//
//  1. It is an ECHO, never the thing itself. Capped at ±1 against direct
//     rapport's ±2, so the person actually in front of you always matters
//     more than who they drink with. A reputation that outweighed the
//     relationship would make direct rapport feel pointless.
//
//  2. It reads only state that already exists — the PC's own relationships
//     and the tick's own ties. Nothing new is written, no new AI channel,
//     and a campaign whose NPCs have no ties behaves exactly as before.

/** One entry of NPC.socialTies. Mirrors Faction.relationships' shape. */
export interface SocialTie {
  type: 'RIVAL' | 'ALLY'
  since?: number
}

/** The PC's rapport with one NPC, as stored on Character.relationships. */
export interface RapportEntry {
  trust?: number
  tension?: number
  respect?: number
  fear?: number
}

/**
 * The cap on reflected rapport. Deliberately half of direct rapport's ±2:
 * what a person's friends think of you is real, and it is not as real as
 * what they think of you themselves.
 */
export const REFLECTED_RAPPORT_CAP = 1

/**
 * How much net goodwill is needed with a third party before it colors
 * anyone else's view of you.
 *
 * A threshold rather than a smooth scale, because reflected feeling is
 * categorical in a way direct feeling isn't: an NPC's ally hearing you are
 * "very slightly on good terms" changes nothing, while hearing you saved
 * their life changes a great deal. 50 on the trust+respect-tension scale
 * is the same step relationshipModifier treats as one full point.
 */
export const REFLECTION_THRESHOLD = 50

export function parseSocialTies(value: unknown): Record<string, SocialTie> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, SocialTie> = {}
  for (const [id, tie] of Object.entries(value as Record<string, unknown>)) {
    const type = (tie as SocialTie | null)?.type
    if (type === 'RIVAL' || type === 'ALLY') out[id] = { type }
  }
  return out
}

/**
 * Net goodwill with one NPC, on the same trust + respect - tension scale
 * relationshipModifier uses. `fear` is deliberately excluded there and
 * excluded here for the same reason: it cuts both ways depending on what
 * you're attempting, and guessing which would be wrong half the time.
 */
export function netGoodwill(rapport: RapportEntry | null | undefined): number {
  if (!rapport) return 0
  const trust = Number(rapport.trust) || 0
  const respect = Number(rapport.respect) || 0
  const tension = Number(rapport.tension) || 0
  return trust + respect - tension
}

/**
 * How this NPC's own allies and rivals color their view of the character.
 *
 * For each tie: a strong feeling toward that third party reflects onto
 * this NPC — positively through an ALLY, inverted through a RIVAL. Being
 * well in with someone's enemy is a liability with them, which is the half
 * that makes this a real social position rather than a bonus track.
 *
 * Pure. Returns 0 for an NPC with no ties, which is every NPC in a
 * campaign whose society tick hasn't run.
 */
export function reflectedRapportModifier(
  socialTies: unknown,
  relationships: Record<string, RapportEntry> | null | undefined
): number {
  const ties = parseSocialTies(socialTies)
  if (!relationships || Object.keys(ties).length === 0) return 0

  let total = 0
  for (const [otherNpcId, tie] of Object.entries(ties)) {
    const goodwill = netGoodwill(relationships[otherNpcId])
    if (Math.abs(goodwill) < REFLECTION_THRESHOLD) continue
    const direction = goodwill > 0 ? 1 : -1
    total += tie.type === 'ALLY' ? direction : -direction
  }

  return Math.max(-REFLECTED_RAPPORT_CAP, Math.min(REFLECTED_RAPPORT_CAP, total))
}

/**
 * Diegetic phrasing for the roll receipt — names the relationship, never a
 * number, consistent with how every other social modifier is surfaced.
 */
export function describeReflectedRapport(mod: number): string {
  return mod > 0 ? 'word travels in your favor' : 'word travels against you'
}
