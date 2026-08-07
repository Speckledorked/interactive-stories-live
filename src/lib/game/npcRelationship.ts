// src/lib/game/npcRelationship.ts
// Player-facing shaping of Character.relationships[npcId] (trust, tension,
// respect, fear — see worldUpdaters/characters.ts's relationship_changes
// handling) into diegetic labels. Same "never expose numbers" rule
// standing.ts already applies to faction standing, extended to the NPC
// axis: raw trust/tension/respect/fear values drive real narration behavior
// (see scenePrompt.ts's <relationships> INTERPRETATION table) but showing
// them as numbers would turn a relationship into a resource to farm.
//
// Distinct from NPC.relationship (the single free-text field on the NPC row
// itself) — that one is a campaign-wide AI-narrated summary shared by every
// viewer. This is per-character: each player's own Character row carries
// its own relationships blob, so two players can genuinely get different
// labels for the same NPC.

export interface NpcRelationshipValues {
  trust: number
  tension: number
  respect: number
  fear: number
}

// Matches scenePrompt.ts's existing <relationships> INTERPRETATION
// thresholds (50+/-50) exactly, so what a player sees here never implies
// more or less than what's actually shaping how the AI writes that NPC.
const NOTABLE_THRESHOLD = 50

/**
 * Diegetic labels for one character's standing with one NPC. Omits any
 * axis that hasn't crossed the notable threshold — a relationship that
 * hasn't been earned either way says nothing, same as summarizeStandings'
 * neutral-omitted convention. Order is fear, trust, tension, respect,
 * roughly most-to-least likely to override how an NPC treats someone.
 */
export function summarizeNpcRelationship(rel: NpcRelationshipValues | null | undefined): string[] {
  if (!rel) return []
  const labels: string[] = []

  if (rel.fear >= NOTABLE_THRESHOLD) labels.push('Fears you')

  if (rel.trust >= NOTABLE_THRESHOLD) labels.push('Trusts you')
  else if (rel.trust <= -NOTABLE_THRESHOLD) labels.push('Distrusts you')

  if (rel.tension >= NOTABLE_THRESHOLD) labels.push('Openly hostile toward you')

  if (rel.respect >= NOTABLE_THRESHOLD) labels.push('Respects you')
  else if (rel.respect <= -NOTABLE_THRESHOLD) labels.push('Dismisses you')

  return labels
}
