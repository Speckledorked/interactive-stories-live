// src/lib/game/quests.ts
//
// Quest structure: a stable handle, and a quest-giver that is a real
// entity rather than a name string (README #45, #75).
//
// What was actually wrong. `Quest.givenBy` is free text with zero code
// consumers, and FAILED/ABANDONED are inert. It's tempting to read that as
// "quests need a gating rule", but the gating rule was never the blocker —
// the blocker is that a quest cannot reach anything. "The magistrate
// remembers you abandoned his job" requires knowing WHICH magistrate, and
// a string can't be queried back to the NPC standing in front of you. So
// this adds the two things every later quest feature needs and no game
// design of its own:
//
//   objectiveKey — a stable per-campaign handle. Quest names are prose and
//                  drift as the fiction re-phrases them ("The Ledger Job"
//                  becomes "Recovering Marek's Ledger"), so anything that
//                  refers to a quest needs something that doesn't move.
//
//   giver FKs    — the commissioning NPC or faction, resolved once and
//                  stored, so consequences can flow back to them.
//
// Deliberately NOT included: preconditions, gating, or any rule about what
// a FAILED quest costs. Those are game design and are being decided
// separately; putting them here ahead of that call would be inventing an
// answer under cover of a refactor.

import { normalizeEntityName, isConfidentFuzzyMatch } from './entityResolution'

/**
 * Stable per-campaign handle for a quest, derived from its name.
 *
 * Deterministic rather than AI-supplied on purpose: a key the narrator
 * invents each turn isn't stable, and stability is the entire point. Same
 * slug shape as slugifyCapabilityKey so keys read alike across the engine.
 *
 * Returns null for a name that slugs to nothing (punctuation only), which
 * the caller stores as NULL — the unique index treats NULLs as distinct,
 * so an unkeyable quest coexists rather than colliding.
 */
export function questObjectiveKey(questName: string): string | null {
  const key = questName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  return key || null
}

export interface QuestGiverCandidate {
  id: string
  name: string
}

export type QuestGiverLink =
  | { kind: 'npc'; id: string; name: string }
  | { kind: 'faction'; id: string; name: string }
  | { kind: 'unresolved' }

/**
 * Resolve a free-text quest-giver to a real NPC or faction. Pure — the
 * caller fetches both rosters once per batch, the same discipline
 * resolveEntityByNameOrId enforces for pc_changes.
 *
 * NPCs are checked before factions because a person is the more specific
 * claim: "Marek of the Ashcrown Court" names a man, and matching it to the
 * Court would attribute his private errand to his whole institution — and
 * that attribution decides who pays for it and who remembers it failed.
 *
 * Exact (normalized) match first across both rosters, then a single
 * confident fuzzy match. An ambiguous fuzzy result resolves to nothing:
 * `givenBy` keeps the raw string either way, so the cost of not resolving
 * is a quest whose giver stays flavor — while the cost of resolving it
 * WRONG is consequences landing on an innocent party.
 */
export function resolveQuestGiver(
  givenBy: string | null | undefined,
  npcs: QuestGiverCandidate[],
  factions: QuestGiverCandidate[]
): QuestGiverLink {
  const wanted = normalizeEntityName(givenBy || '')
  if (!wanted) return { kind: 'unresolved' }

  const exactNpc = npcs.find(n => normalizeEntityName(n.name) === wanted)
  if (exactNpc) return { kind: 'npc', id: exactNpc.id, name: exactNpc.name }

  const exactFaction = factions.find(f => normalizeEntityName(f.name) === wanted)
  if (exactFaction) return { kind: 'faction', id: exactFaction.id, name: exactFaction.name }

  const fuzzyNpcs = npcs.filter(n => isConfidentFuzzyMatch(givenBy!, n.name))
  const fuzzyFactions = factions.filter(f => isConfidentFuzzyMatch(givenBy!, f.name))
  const total = fuzzyNpcs.length + fuzzyFactions.length
  if (total !== 1) return { kind: 'unresolved' }

  if (fuzzyNpcs.length === 1) {
    return { kind: 'npc', id: fuzzyNpcs[0].id, name: fuzzyNpcs[0].name }
  }
  return { kind: 'faction', id: fuzzyFactions[0].id, name: fuzzyFactions[0].name }
}

/**
 * The giver link as Prisma update data. Both columns are always written so
 * a re-resolved giver clears the other side rather than leaving a quest
 * attributed to an NPC *and* a faction — at most one can be true, and a
 * stale second link would double-charge whoever pays for it.
 */
export function questGiverUpdateData(link: QuestGiverLink): {
  givenByNpcId: string | null
  givenByFactionId: string | null
} {
  return {
    givenByNpcId: link.kind === 'npc' ? link.id : null,
    givenByFactionId: link.kind === 'faction' ? link.id : null,
  }
}

export type QuestStatus = 'ACTIVE' | 'COMPLETED' | 'FAILED' | 'ABANDONED'

// #281 (adversarial audit, Finding #12): the concurrency guard in
// worldUpdaters/quests.ts protects against a RACE (two resolutions
// applying to the same read status) but nothing previously checked
// whether the reported transition was even legal — the AI reporting
// status: 'COMPLETED' for a quest whose real status is 'FAILED'
// (hallucination, or a narrative retcon) wrote it unconditionally,
// double-granting a completion reward on top of the failure cost already
// charged when it failed.
//
// Deliberately NOT "once terminal, always terminal" for every status: a
// quest that FAILED and is later explicitly ABANDONED (or vice versa) is
// an existing, intentionally-tested distinct outcome — see
// worldUpdaters/quests.ts's failure-cost tests — not a repeat, and each
// still charges its own failure cost. What's actually illegal is
// completing something already resolved as lost (COMPLETED can only ever
// be reached from ACTIVE), and undoing a genuine completion at all —
// COMPLETED is the one truly one-way mark.
export function isLegalQuestStatusTransition(from: QuestStatus, to: QuestStatus): boolean {
  if (from === to) return false
  if (from === 'COMPLETED') return false
  if (to === 'COMPLETED' && from !== 'ACTIVE') return false
  return true
}
