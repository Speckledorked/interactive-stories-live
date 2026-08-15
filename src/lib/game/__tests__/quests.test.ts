// src/lib/game/__tests__/quests.test.ts
//
// Quest structure (#45, #75): the stable handle, and resolving a free-text
// quest-giver to a real entity. The behavior worth pinning down is what
// happens when resolution is UNCERTAIN — attributing a quest to the wrong
// party is worse than leaving it attributed to nobody, because whoever it
// lands on is who pays for it and who remembers it failed.

import { describe, it, expect } from 'vitest'
import { questObjectiveKey, resolveQuestGiver, questGiverUpdateData, isLegalQuestStatusTransition } from '../quests'

const npc = (id: string, name: string) => ({ id, name })

describe('questObjectiveKey', () => {
  it('slugs a quest name into a stable handle', () => {
    expect(questObjectiveKey('The Ledger Job')).toBe('the-ledger-job')
    expect(questObjectiveKey("Recover Marek's Ledger!")).toBe('recover-marek-s-ledger')
  })

  it('is stable across punctuation and casing the fiction might vary', () => {
    expect(questObjectiveKey('The Ledger Job')).toBe(questObjectiveKey('the  LEDGER   job.'))
  })

  it('returns null rather than an empty key for an unslugabble name', () => {
    // Stored as NULL, which the unique index treats as distinct — an
    // unkeyable quest coexists instead of colliding with every other one.
    expect(questObjectiveKey('!!!')).toBeNull()
    expect(questObjectiveKey('   ')).toBeNull()
  })

  it('bounds the key length', () => {
    expect(questObjectiveKey('a'.repeat(200))!.length).toBeLessThanOrEqual(64)
  })
})

describe('resolveQuestGiver', () => {
  const npcs = [npc('n1', 'Marek Voss'), npc('n2', 'Lady Ashcrown')]
  const factions = [npc('f1', 'The Ashcrown Court'), npc('f2', 'Thieves Guild')]

  it('resolves an exact NPC name', () => {
    expect(resolveQuestGiver('Marek Voss', npcs, factions)).toEqual({ kind: 'npc', id: 'n1', name: 'Marek Voss' })
  })

  it('resolves an exact faction name', () => {
    expect(resolveQuestGiver('Thieves Guild', npcs, factions)).toEqual({ kind: 'faction', id: 'f2', name: 'Thieves Guild' })
  })

  it('prefers a person over an institution', () => {
    // "Lady Ashcrown" naming the Court would attribute her private errand
    // to her whole institution — and that decides who pays for it.
    expect(resolveQuestGiver('Lady Ashcrown', npcs, factions)).toEqual(
      { kind: 'npc', id: 'n2', name: 'Lady Ashcrown' }
    )
  })

  it('tolerates the phrasing drift a narrator actually produces', () => {
    expect(resolveQuestGiver('Marek Vos', npcs, factions)).toEqual({ kind: 'npc', id: 'n1', name: 'Marek Voss' })
  })

  it('resolves nothing when a fuzzy match is ambiguous', () => {
    // Two plausible matches means we do not know. givenBy keeps the raw
    // string either way, so the cost of not resolving is flavor; the cost
    // of resolving wrong is consequences landing on an innocent party.
    const twins = [npc('n1', 'Marek Voss'), npc('n3', 'Marek Vossa')]
    expect(resolveQuestGiver('Marek Vosso', twins, [])).toEqual({ kind: 'unresolved' })
  })

  it('resolves nothing for a giver that matches no one', () => {
    expect(resolveQuestGiver('Some Stranger', npcs, factions)).toEqual({ kind: 'unresolved' })
  })

  it('resolves nothing for an absent or empty giver', () => {
    expect(resolveQuestGiver(null, npcs, factions)).toEqual({ kind: 'unresolved' })
    expect(resolveQuestGiver(undefined, npcs, factions)).toEqual({ kind: 'unresolved' })
    expect(resolveQuestGiver('   ', npcs, factions)).toEqual({ kind: 'unresolved' })
  })

  it('never matches on a substring', () => {
    // The `contains` pattern removed elsewhere in this engine (#3/#40).
    expect(resolveQuestGiver('Marek', [npc('n1', 'Marek Voss of the Low Quarter')], [])).toEqual(
      { kind: 'unresolved' }
    )
  })
})

describe('questGiverUpdateData', () => {
  it('sets exactly one side', () => {
    expect(questGiverUpdateData({ kind: 'npc', id: 'n1', name: 'x' }))
      .toEqual({ givenByNpcId: 'n1', givenByFactionId: null })
    expect(questGiverUpdateData({ kind: 'faction', id: 'f1', name: 'x' }))
      .toEqual({ givenByNpcId: null, givenByFactionId: 'f1' })
  })

  it('clears both when the giver is unresolved', () => {
    // Always writing both columns is what stops a re-resolved giver from
    // leaving a stale second link — a quest attributed to an NPC *and* a
    // faction would be charged to both.
    expect(questGiverUpdateData({ kind: 'unresolved' }))
      .toEqual({ givenByNpcId: null, givenByFactionId: null })
  })
})

describe('isLegalQuestStatusTransition (#281)', () => {
  it('allows ACTIVE to transition to any of the three terminal statuses', () => {
    expect(isLegalQuestStatusTransition('ACTIVE', 'COMPLETED')).toBe(true)
    expect(isLegalQuestStatusTransition('ACTIVE', 'FAILED')).toBe(true)
    expect(isLegalQuestStatusTransition('ACTIVE', 'ABANDONED')).toBe(true)
  })

  it('refuses completing a quest already resolved as failed/abandoned', () => {
    // The exact scenario the issue names: an AI hallucination or
    // narrative retcon reporting COMPLETED for a quest that already
    // FAILED must not double-grant a reward on top of the failure cost
    // already charged.
    expect(isLegalQuestStatusTransition('FAILED', 'COMPLETED')).toBe(false)
    expect(isLegalQuestStatusTransition('ABANDONED', 'COMPLETED')).toBe(false)
  })

  it('refuses anything moving away from a genuine completion', () => {
    // COMPLETED is the one truly one-way mark — nothing undoes it.
    expect(isLegalQuestStatusTransition('COMPLETED', 'ACTIVE')).toBe(false)
    expect(isLegalQuestStatusTransition('COMPLETED', 'FAILED')).toBe(false)
    expect(isLegalQuestStatusTransition('COMPLETED', 'ABANDONED')).toBe(false)
  })

  it('still allows FAILED and ABANDONED to transition into each other, an intentionally distinct outcome', () => {
    // Not the exploit this issue names — each is its own failure-cost
    // event (see worldUpdaters/quests.ts's own failure-consequences
    // tests), not a repeat of the same one.
    expect(isLegalQuestStatusTransition('FAILED', 'ABANDONED')).toBe(true)
    expect(isLegalQuestStatusTransition('ABANDONED', 'FAILED')).toBe(true)
  })

  it('treats reporting the same status again as not a transition at all', () => {
    expect(isLegalQuestStatusTransition('ACTIVE', 'ACTIVE')).toBe(false)
    expect(isLegalQuestStatusTransition('COMPLETED', 'COMPLETED')).toBe(false)
  })
})
